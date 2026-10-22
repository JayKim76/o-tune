import type { AntiPatternResult, DiagnosticOutput, DiagnosticInput } from '../types/oracle';

/**
 * SQL 정규화: 리터럴을 바인드 변수(:b1, :b2, ...)로 변환한다.
 *
 * 처리 원칙 (2026-10-22 수정):
 * - 힌트 블록은 먼저 분리해 보호한다. 힌트 안의 숫자(FIRST_ROWS(10) 등)는 리터럴이 아니다.
 * - 문자열 리터럴은 '' 이스케이프를 포함한 전체를 하나의 리터럴로 인식한다 ('O''BRIEN' → :b1 하나).
 * - 숫자 리터럴은 소수·음수를 포함해 토큰 단위로 치환하고, 식별자 속 숫자(t1, col2)는 건드리지 않는다.
 *   IN (1, 2, 3), BETWEEN 10 AND 20처럼 연산자 뒤가 아닌 숫자도 모두 치환한다.
 */
export function normalizeSql(sql: string): {
  normalizedSql: string;
  bindVariables: { name: string; originalValue: string }[]
} {
  let count = 1;
  const bindVariables: { name: string; originalValue: string }[] = [];
  const nextVar = (originalValue: string) => {
    const varName = `:b${count++}`;
    bindVariables.push({ name: varName, originalValue });
    return varName;
  };

  // 1) 힌트 블록 보호
  const hintBlocks: string[] = [];
  let working = sql.replace(/\/\*\+[\s\S]*?\*\//g, (m) => {
    hintBlocks.push(m);
    return `\u0001HINT${hintBlocks.length - 1}\u0001`;
  });

  // 2) 문자열 리터럴 치환 ('' 이스케이프 처리)
  working = working.replace(/'(?:''|[^'])*'/g, (m) => nextVar(m));

  // 3) 숫자 리터럴 치환 (소수·음수 포함, 식별자 내부 숫자는 제외)
  working = working.replace(/(^|[^\w$.])(-?\d+(?:\.\d+)?)(?![\w$.])/g, (_m, prefix: string, num: string) => {
    return `${prefix}${nextVar(num)}`;
  });

  // 4) 힌트 블록 복원 (플레이스홀더 구분자로 제어문자를 의도적으로 사용)
  // oxlint-disable-next-line no-control-regex
  working = working.replace(/\u0001HINT(\d+)\u0001/g, (_m, idx: string) => hintBlocks[Number(idx)]);

  return { normalizedSql: working, bindVariables };
}

/** DBMS_XPLAN 텍스트에서 SELECT STATEMENT 행의 Cost를 추출한다. 없으면 null. */
export function parsePlanCost(planText: string): number | null {
  const line = planText.split('\n').find((l) => l.includes('SELECT STATEMENT'));
  if (!line) return null;
  const m = line.match(/\|\s*(\d[\d,]*)\s*\(\d+\)\s*\|/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** DBMS_XPLAN 텍스트에서 SELECT STATEMENT 행의 Time(HH:MM:SS)을 초로 변환한다. 없으면 null. */
export function parsePlanTimeSec(planText: string): number | null {
  const line = planText.split('\n').find((l) => l.includes('SELECT STATEMENT'));
  if (!line) return null;
  const m = line.match(/(\d+):(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** ALLSTATS 포맷(E-Rows/A-Rows 컬럼이 있는 실행계획)에서 E-Rows와 A-Rows 괴리가 큰 행이 있는지 검사한다. */
function hasCardinalityMismatch(planText: string): boolean {
  if (!/E-Rows/i.test(planText) || !/A-Rows/i.test(planText)) return false;
  for (const line of planText.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    // ALLSTATS LAST 포맷: ['', Id, Operation, Name, Starts, E-Rows, A-Rows, ...]
    if (cells.length < 7) continue;
    const eRows = Number(cells[5]);
    const aRows = Number(cells[6]);
    if (!Number.isFinite(eRows) || !Number.isFinite(aRows) || eRows <= 0) continue;
    const ratio = aRows / eRows;
    if (ratio >= 10 || ratio <= 0.1) return true;
  }
  return false;
}

/**
 * SQL 및 DBMS_XPLAN 실행계획 텍스트를 기반으로 안티패턴 자동 감지.
 * 키워드 단순 포함이 아니라, 각 패턴의 실제 조건을 검사한다 (2026-10-22 수정).
 */
export function analyzeAntiPatterns(sql: string, planText: string): AntiPatternResult[] {
  const results: AntiPatternResult[] = [];
  const upperSql = sql.toUpperCase();
  const upperPlan = planText.toUpperCase();
  const fromClause = upperSql.slice(Math.max(upperSql.indexOf('FROM'), 0));

  // 1. Full Table Scan 감지 — TABLE ACCESS FULL 연산이 실제로 있을 때만
  if (upperPlan.includes('TABLE ACCESS FULL')) {
    results.push({
      type: 'FULL_TABLE_SCAN',
      title: 'Full Table Scan (대용량 테이블 인덱스 미사용 스캔)',
      detectedLogic: '실행 계획 상 TABLE ACCESS FULL 연산이 감지되었습니다. 대용량 테이블에 대한 Full Scan은 디스크 I/O 폭증의 주원인입니다.',
      recommendation: '주요 조건 컬럼에 결합 인덱스 생성을 검토하고, Optimizer가 인덱스를 타도록 /*+ INDEX(table_alias index_name) */ 힌트를 주입하십시오.',
      suggestedHints: ['/*+ INDEX(t idx_name) */'],
      severity: 'HIGH'
    });
  }

  // 2. Join Order 오류 감지 — 카테시안 조인이 실제로 있을 때만
  if (upperPlan.includes('CARTESIAN')) {
    results.push({
      type: 'JOIN_ORDER_ERROR',
      title: 'Join Order 오류 (Driving Table 선택 실패)',
      detectedLogic: '카테시안 조인으로 인해 중간 결과셋 카디널리티가 과도하게 비대해지는 현상이 감지되었습니다.',
      recommendation: '결과셋이 작은 테이블을 Driving Table로 지정하도록 /*+ LEADING(t1 t2) */ 힌트 및 OPT_ESTIMATE로 카디널리티를 보정하십시오.',
      suggestedHints: ['/*+ LEADING(t1 t2) */'],
      severity: 'HIGH'
    });
  }

  // 3. NL Join 남용 감지 — ANSI JOIN 키워드가 없어도(콤마 조인 포함) NL + 테이블 접근이면 감지
  const hasNestedLoops = upperPlan.includes('NESTED LOOPS');
  const hasJoin = fromClause.includes(',') || upperSql.includes(' JOIN ');
  if (hasNestedLoops && hasJoin && (upperPlan.includes('TABLE ACCESS FULL') || upperPlan.includes('TABLE ACCESS BY INDEX'))) {
    results.push({
      type: 'NL_JOIN_OVERUSE',
      title: 'NL Join 남용 (대량 데이터 조인 시 Hash Join 미사용)',
      detectedLogic: '조인 대상 접근과 함께 NESTED LOOPS 조인이 감지되었습니다. 대용량 데이터셋에서는 반복적인 Random Access를 유발할 수 있습니다.',
      recommendation: '대량 데이터 조인 연산에는 메모리 기반 Hash Join이 효율적일 수 있습니다. /*+ USE_HASH(t1 t2) */ 힌트를 주입하거나 SQL Profile을 적용하십시오.',
      suggestedHints: ['/*+ USE_HASH(t1 t2) */'],
      severity: 'MEDIUM'
    });
  }

  // 4. Parsing 부하 / 리터럴 감지 — 바인드 변수 없이 리터럴이 3개 이상일 때
  const { bindVariables } = normalizeSql(sql);
  if (bindVariables.length >= 3 && !sql.includes(':')) {
    results.push({
      type: 'PARSING_OVERHEAD',
      title: 'Parsing 부하 (하드 파싱 & 리터럴 스키마 감지)',
      detectedLogic: `쿼리 내에 바인드 변수 대신 리터럴 ${bindVariables.length}개가 직접 입력되어 라이브러리 캐시 래치 경합 및 하드 파싱 부하를 유발할 수 있습니다.`,
      recommendation: '리터럴을 바인드 변수로 변경하고, 시스템 차원에서 CURSOR_SHARING = FORCE 혹은 SQL Profile을 활용하십시오.',
      suggestedHints: ['/*+ CURSOR_SHARING_EXACT */'],
      severity: 'HIGH'
    });
  }

  // 5. Cardinality 왜곡 감지 — ALLSTATS 포맷에서 E-Rows/A-Rows 괴리를 실제로 비교했을 때만
  if (hasCardinalityMismatch(planText)) {
    results.push({
      type: 'CARDINALITY_MISMATCH',
      title: 'Cardinality 왜곡 (예측 Row vs 실제 Executed Row 현격한 차이)',
      detectedLogic: '실행계획(ALLSTATS)의 E-Rows와 A-Rows 간 10배 이상의 괴리가 확인되었습니다. 옵티마이저 통계 또는 바인드 피킹 문제일 가능성이 높습니다.',
      recommendation: 'SQL Profile 내부 혹은 쿼리에 /*+ OPT_ESTIMATE */ 힌트를 주입하여 옵티마이저의 비용 계산 방식을 근본적으로 교정하십시오.',
      suggestedHints: ['/*+ OPT_ESTIMATE(TABLE t ROWS=1000) */'],
      severity: 'MEDIUM'
    });
  }

  // 감지된 것이 없다면 기본 권고사항 1개 제공
  if (results.length === 0) {
    results.push({
      type: 'FULL_TABLE_SCAN',
      title: '잠재적 인덱스 및 조인 순서 검토',
      detectedLogic: '명확한 치명적 안티패턴은 없으나, Execution Plan에서 I/O 스캔 비중 분석이 필요합니다.',
      recommendation: 'Execution Plan의 Cost 및 Buffer Gets를 모니터링하고 적절한 힌트주입 또는 SQL Profile 적용을 검토하십시오.',
      suggestedHints: ['/*+ ALL_ROWS */'],
      severity: 'LOW'
    });
  }

  return results;
}

/** 힌트 본문을 단위(힌트명 + 선택적 괄호 인자)로 분해한다. */
function splitHintUnits(hintBody: string): string[] {
  const units: string[] = [];
  let i = 0;
  while (i < hintBody.length) {
    while (i < hintBody.length && /\s/.test(hintBody[i])) i++;
    if (i >= hintBody.length) break;
    let unit = '';
    while (i < hintBody.length && /[\w]/.test(hintBody[i])) unit += hintBody[i++];
    if (hintBody[i] === '(') {
      let depth = 0;
      while (i < hintBody.length) {
        const ch = hintBody[i++];
        unit += ch;
        if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) break;
      }
    }
    if (unit) units.push(unit);
    // 괄호 뒤 공백·콤마는 다음 단위에서 처리
  }
  return units;
}

const JOIN_METHOD_HINTS = new Set(['USE_NL', 'USE_HASH', 'USE_MERGE']);

/**
 * 추천 힌트들을 하나의 힌트 블록으로 병합해 튜닝 SQL을 생성한다.
 * - 힌트 블록이 아닌 일반 문장(예: "바인드 변수 사용")은 SQL에 삽입하지 않는다.
 * - 상충 힌트(USE_NL vs USE_HASH 등)는 먼저 감지된 패턴의 것을 우선한다.
 */
export function generateTunedSql(rawSql: string, hints: string[]): string {
  const units: string[] = [];
  for (const hint of hints) {
    const block = hint.match(/\/\*\+\s*([\s\S]*?)\*\//);
    if (!block) continue; // 힌트가 아닌 권고 문장은 SQL에 넣지 않음
    units.push(...splitHintUnits(block[1]));
  }

  const merged: string[] = [];
  let joinMethodUsed = false;
  for (const unit of units) {
    const name = (unit.match(/^([A-Za-z_]+)/)?.[1] || '').toUpperCase();
    if (JOIN_METHOD_HINTS.has(name)) {
      if (joinMethodUsed) continue;
      joinMethodUsed = true;
    }
    if (!merged.includes(unit)) merged.push(unit);
  }

  if (merged.length === 0) return rawSql;
  const hintBlock = `/*+ ${merged.join(' ')} */`;

  if (/^\s*SELECT/i.test(rawSql)) {
    return rawSql.replace(/^(\s*SELECT)\s+/i, `$1 ${hintBlock} `);
  }
  return `-- Tuned SQL with Hints: ${hintBlock}\n${rawSql}`;
}

/**
 * 종합 진단 실행.
 * 성능 수치는 실행계획에서 실제로 파싱한 Time을 기반으로 산출한다 (2026-10-22 수정).
 * - 튜닝 전: 실행계획 SELECT STATEMENT 행의 Time
 * - 튜닝 후: 감지 패턴 심각도 기반의 추정치이며 실측이 아니다. 화면에 "예상"으로 표시할 것.
 * - 실행계획에서 Time을 읽을 수 없으면 0을 반환한다 (고정값을 지어내지 않는다).
 * - benefitRatioPercent는 이 쿼리 자체의 예상 개선율이다.
 *   스냅샷 전체 DB Time 대비 비중은 AWR 데이터가 있어야 산출할 수 있다.
 */
export function runFullDiagnostics(input: DiagnosticInput): DiagnosticOutput {
  const { normalizedSql, bindVariables } = normalizeSql(input.rawSql);
  const detectedAntiPatterns = analyzeAntiPatterns(input.rawSql, input.executionPlanText);

  const recommendedHints = Array.from(new Set(
    detectedAntiPatterns.flatMap(ap => ap.suggestedHints)
  ));

  const tunedSql = generateTunedSql(normalizedSql, recommendedHints);

  const planTimeSec = parsePlanTimeSec(input.executionPlanText);
  const originalDbTimeSec = planTimeSec ?? 0;

  let remainRatio = 1;
  for (const ap of detectedAntiPatterns) {
    if (ap.severity === 'HIGH') remainRatio *= 0.3;
    else if (ap.severity === 'MEDIUM') remainRatio *= 0.6;
  }
  if (detectedAntiPatterns.length === 1 && detectedAntiPatterns[0].severity === 'LOW') remainRatio = 1;

  const estimatedTunedDbTimeSec = planTimeSec !== null
    ? Number((planTimeSec * Math.max(remainRatio, 0.05)).toFixed(2))
    : 0;

  const benefitRatioPercent = originalDbTimeSec > 0
    ? Number((((originalDbTimeSec - estimatedTunedDbTimeSec) / originalDbTimeSec) * 100).toFixed(1))
    : 0;

  return {
    normalizedSql,
    extractedBindVariables: bindVariables,
    detectedAntiPatterns,
    recommendedHints,
    tunedSql,
    originalDbTimeSec,
    estimatedTunedDbTimeSec,
    benefitRatioPercent
  };
}
