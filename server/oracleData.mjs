// Oracle 백엔드 에이전트의 순수 데이터 처리 함수 모음.
// DB 접속과 분리되어 있어 단위 테스트가 가능하다.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

const HOST_PATTERN = /^[A-Za-z0-9._-]+$/;
const SERVICE_PATTERN = /^[A-Za-z0-9._$-]+$/;
const USER_PATTERN = /^[A-Za-z0-9._$-]+$/;

function requiredString(value, field, pattern, maxLength = 128) {
  if (typeof value !== 'string') throw new ValidationError(`${field} 값이 필요합니다.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || !pattern.test(trimmed)) {
    throw new ValidationError(`${field} 형식이 올바르지 않습니다.`);
  }
  return trimmed;
}

/**
 * 브라우저가 보낸 연결 설정을 검증한다.
 * 비밀번호는 검증만 하고 반환 객체 외 어디에도 저장·기록하지 않는다.
 */
export function validateConnectionConfig(input) {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('연결 설정이 필요합니다.');
  }

  const host = requiredString(input.host, '호스트', HOST_PATTERN, 255);
  const serviceName = requiredString(input.serviceName, '서비스명', SERVICE_PATTERN, 128);
  const username = requiredString(input.username, '사용자명', USER_PATTERN, 128);

  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ValidationError('포트는 1~65535 사이의 정수여야 합니다.');
  }

  if (typeof input.password !== 'string' || input.password.length === 0 || input.password.length > 512) {
    throw new ValidationError('비밀번호가 필요합니다.');
  }

  return {
    host,
    port,
    serviceName,
    username,
    password: input.password,
    useDrcp: input.useDrcp === true,
    agentToken: typeof input.agentToken === 'string' ? input.agentToken : undefined,
  };
}

/** Easy Connect 문자열을 만든다. DRCP 사용 시 서비스 뒤에 :POOLED를 붙인다. */
export function buildConnectString(config) {
  const service = config.useDrcp ? `${config.serviceName}:POOLED` : config.serviceName;
  return `${config.host}:${config.port}/${service}`;
}

export function clampLimit(value, fallback = 10) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(20, Math.max(1, Math.trunc(parsed)));
}

export function toNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export function microToSec(value) {
  return Number((toNumber(value) / 1_000_000).toFixed(4));
}

/**
 * V$SQLSTATS 행을 프론트엔드 공용 형태로 변환한다.
 * dbTimePercentage는 전체 SQL elapsed_time 합계 대비 비중이며,
 * 전체 합계를 읽지 못한 경우 조회된 행들의 합계를 분모로 쓴다.
 */
export function mapTopSqlRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const totalFromRows = list.reduce((sum, row) => sum + toNumber(row.elapsedTimeMicro), 0);

  return list.map((row, index) => {
    const totalElapsedMicro = toNumber(row.totalElapsedTimeMicro) || totalFromRows;
    const elapsedTimeMicro = toNumber(row.elapsedTimeMicro);
    return {
      id: `live-${row.sqlId || index}`,
      sqlId: String(row.sqlId || ''),
      sqlText: String(row.sqlText || ''),
      elapsedTimeSec: microToSec(elapsedTimeMicro),
      cpuTimeSec: microToSec(row.cpuTimeMicro),
      userIoWaitSec: microToSec(row.userIoWaitTimeMicro),
      bufferGets: toNumber(row.bufferGets),
      diskReads: toNumber(row.diskReads),
      executions: toNumber(row.executions),
      dbTimePercentage: totalElapsedMicro > 0
        ? Number(((elapsedTimeMicro / totalElapsedMicro) * 100).toFixed(2))
        : 0,
      executionPlan: typeof row.executionPlan === 'string' ? row.executionPlan : '',
    };
  });
}

/** V$SYSSTAT 누적값으로 인스턴스 시작 이후 버퍼 캐시 히트율을 계산한다. */
export function calculateBufferCacheHitRatio(stats) {
  const values = new Map();
  for (const row of Array.isArray(stats) ? stats : []) {
    values.set(String(row.name || '').toLowerCase(), toNumber(row.value));
  }
  const physicalReads = values.get('physical reads cache') ?? 0;
  const logicalReads = (values.get('consistent gets from cache') ?? 0)
    + (values.get('db block gets from cache') ?? 0);
  if (logicalReads <= 0) return null;
  const ratio = (1 - physicalReads / logicalReads) * 100;
  return Number(Math.min(100, Math.max(0, ratio)).toFixed(2));
}

/**
 * EXPLAIN PLAN 대상 SQL 정리: 끝의 세미콜론을 제거하고 비어 있으면 거부한다.
 * SELECT 전용 여부는 호출자가 학습 채점기와 같은 가드(isSelectOnly)로 판정한다.
 */
export function cleanExplainTargetSql(sql) {
  const cleaned = String(sql || '').trim().replace(/;+\s*$/, '').trim();
  if (!cleaned) throw new ValidationError('실행계획을 확인할 SQL이 비어 있습니다.');
  if (cleaned.length > 100_000) throw new ValidationError('SQL이 너무 깁니다. (100,000자 이하)');
  return cleaned;
}

/** statement_id는 서버가 만든 값만 허용한다 (SQL에 그대로 들어가기 때문). */
export function assertStatementId(statementId) {
  if (!/^[A-Z0-9_]{1,30}$/.test(String(statementId || ''))) {
    throw new ValidationError('statement_id 형식이 올바르지 않습니다.');
  }
  return statementId;
}

export function buildExplainPlanSql(statementId, sql) {
  assertStatementId(statementId);
  return `EXPLAIN PLAN SET STATEMENT_ID = '${statementId}' FOR ${sql}`;
}

export const EXPLAIN_PLAN_TABLE_SQL = `SELECT PLAN_TABLE_OUTPUT AS "planLine"
    FROM TABLE(DBMS_XPLAN.DISPLAY_PLAN_TABLE(:statementId, NULL, 'TYPICAL +PREDICATE'))`;

export const EXPLAIN_PLAN_CLEANUP_SQL = 'DELETE FROM PLAN_TABLE WHERE STATEMENT_ID = :statementId';

/** 설명 대상 SQL에 등장하는 이름 바인드(:b1 등) 목록. EXPLAIN 시 더미 바인딩에 쓴다. */
export function extractBindNames(sql) {
  const names = new Set();
  const pattern = /(?<!:):([A-Za-z][A-Za-z0-9_$#]*)/g;
  let match;
  while ((match = pattern.exec(String(sql || ''))) !== null) names.add(match[1]);
  return [...names];
}

/** DISPLAY_PLAN_TABLE 결과 행들을 실행계획 텍스트로 합친다. */
export function planRowsToText(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.planLine ?? row?.PLAN_TABLE_OUTPUT ?? ''))
    .join('\n')
    .trim();
}

export function sanitizeOracleError(error) {
  const raw = String(error?.message || error || 'Oracle 연결 중 알 수 없는 오류가 발생했습니다.');
  // 연결 문자열이나 비밀번호가 오류 메시지에 섞여도 클라이언트에 그대로 내보내지 않는다.
  return raw
    .replace(/(password\s*[:=]\s*)\S+/gi, '$1[hidden]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}
