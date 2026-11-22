// 샌드박스 Oracle 실행 러너.
// 격리 전제 (실측 전에 반드시 충족, training/README.md 체크리스트 참고):
// - 접속 계정은 대상 스키마에 SELECT만 있고 EXECUTE/CREATE 권한이 없다.
//   문자열 가드(scorer.isSelectOnly)는 2차 방어선일 뿐, 권한이 1차 방어선이다.
// - 실행 DB는 운영과 분리된 샌드박스(PDB 클론 등)이며 운영 계정을 재사용하지 않는다.
// - Resource Manager 등으로 CPU/실행 시간 상한을 거는 것을 권장한다.
// 전제: 샌드박스 스키마(DDL+통계)는 케이스별로 미리 준비되어 있다.
// 접속 정보는 환경변수로만 받는다.
//
//   OTUNE_SANDBOX_USER, OTUNE_SANDBOX_PASSWORD, OTUNE_SANDBOX_CONNECT_STRING
//   예) OTUNE_SANDBOX_CONNECT_STRING=localhost:1521/FREEPDB1

import oracledb from 'oracledb';
import { hashRows } from './scorer.mjs';

export function getSandboxConfigFromEnv(env = process.env) {
  const user = env.OTUNE_SANDBOX_USER;
  const password = env.OTUNE_SANDBOX_PASSWORD;
  const connectString = env.OTUNE_SANDBOX_CONNECT_STRING;
  if (!user || !password || !connectString) {
    throw new Error(
      '샌드박스 접속 환경변수가 필요합니다: OTUNE_SANDBOX_USER, OTUNE_SANDBOX_PASSWORD, OTUNE_SANDBOX_CONNECT_STRING',
    );
  }
  return { user, password, connectString };
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 측정 세션 시작 시 적용하는 세션 설정.
 * RESULT_CACHE_MODE=MANUAL: RESULT_CACHE 힌트가 있어도 세션이 강제하지 않는 한
 * 결과 캐시를 쓰지 않게 한다. 금지 힌트 차단(scorer)과 함께 캐시 해킹을 막는 이중 장치.
 */
export const SANDBOX_SESSION_SQLS = [
  `ALTER SESSION SET RESULT_CACHE_MODE = MANUAL`,
];

export async function prepareSandboxSession(connection) {
  for (const sql of SANDBOX_SESSION_SQLS) {
    await connection.execute(sql);
  }
}

/** 측정값 목록을 대표값으로 요약한다. elapsed와 bufferGets는 중앙값, cost는 마지막 값. */
export function summarizeMeasures(measures) {
  const ok = (Array.isArray(measures) ? measures : []).filter((m) => m && m.status === 'ok');
  if (ok.length === 0) return null;
  const last = ok[ok.length - 1];
  return {
    ...last,
    elapsedSec: median(ok.map((m) => m.elapsedSec)),
    bufferGets: median(ok.map((m) => m.bufferGets)),
  };
}

/**
 * DBMS_XPLAN 출력에서 Buffers 합계와 SELECT STATEMENT Cost를 파싱한다.
 * 열 위치는 헤더 행에서 찾으므로 TYPICAL/ALLSTATS 포맷 차이에 영향받지 않는다.
 */
function firstNumber(cell) {
  const match = String(cell || '').match(/[0-9][0-9,]*(\.[0-9]+)?/);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

export function parsePlanStats(planText) {
  const lines = String(planText || '').split('\n');
  let headerCells = null;
  let bufferGets = 0;
  let cost = null;

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.includes('Id') && cells.some((c) => c.startsWith('Cost'))) {
      headerCells = cells;
      continue;
    }
    if (!headerCells) continue;
    const id = cells[headerCells.indexOf('Id')];
    if (!/^\*?\d+$/.test(id || '')) continue;

    const buffersIdx = headerCells.indexOf('Buffers');
    if (buffersIdx >= 0) {
      const value = firstNumber(cells[buffersIdx]);
      if (value !== null) bufferGets += value;
    }
    if (id.replace('*', '') === '0') {
      const costIdx = headerCells.findIndex((c) => c.startsWith('Cost'));
      if (costIdx >= 0) {
        const value = firstNumber(cells[costIdx]);
        if (value !== null) cost = value; // '1240 (2)'에서 앞 숫자만 취한다
      }
    }
  }
  return { bufferGets, cost };
}

function isTimeoutError(error) {
  const message = String(error?.message || '');
  return /NJS-123|call timeout|DPi-1067|ORA-03135|ORA-03113/i.test(message)
    || /timeout/i.test(message);
}

/** SQL 1건을 실행하고 결과 행과 실행계획 기반 지표를 측정한다. */
export async function measureSql(connection, sql, { timeoutSec = 30 } = {}) {
  connection.callTimeout = timeoutSec * 1000;
  const startedAt = performance.now();
  let result;
  try {
    result = await connection.execute(sql, [], {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
      maxRows: 100000,
    });
  } catch (error) {
    if (isTimeoutError(error)) return { status: 'timeout', rows: [], elapsedSec: timeoutSec, bufferGets: 0, cost: 0 };
    return { status: 'error', rows: [], elapsedSec: 0, bufferGets: 0, cost: 0, error: String(error?.message || error) };
  }
  const elapsedSec = (performance.now() - startedAt) / 1000;

  let bufferGets = 0;
  let cost = 0;
  try {
    const plan = await connection.execute(
      `SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST'))`,
      [],
      { outFormat: oracledb.OUT_FORMAT_ARRAY },
    );
    const planText = (plan.rows || []).map((r) => String(r[0] || '')).join('\n');
    const stats = parsePlanStats(planText);
    bufferGets = stats.bufferGets;
    cost = stats.cost || 0;
  } catch { /* 실행계획을 못 읽으면 지표 0으로 두고 elapsed만 사용 */ }

  return { status: 'ok', rows: result.rows || [], elapsedSec, bufferGets, cost };
}

/**
 * 케이스 1건의 원본/후보를 샌드박스에서 측정한다.
 * 측정 순서 편향을 줄이기 위해:
 * - 원본/후보를 각각 1회 워밍업 실행하고 그 결과는 버린다 (캐시 워밍 동등화).
 * - 본 측정은 원본→후보 순서로 교차 실행하고, 대표값은 중앙값이다.
 * 반환값은 scorer.scoreCandidate의 execution 형태와 호환된다.
 */
export async function runCaseInSandbox(caseData, candidateSql, config, { timeoutSec = 30, runs = 3 } = {}) {
  let connection;
  try {
    connection = await oracledb.getConnection(config);
    await prepareSandboxSession(connection);

    // 워밍업: 양쪽 모두 1회 실행해 버퍼 캐시 상태를 동등하게 만든 뒤 버린다.
    const warmOrig = await measureSql(connection, caseData.original_sql, { timeoutSec });
    if (warmOrig.status !== 'ok') {
      return { status: warmOrig.status, originalMeasure: warmOrig, candidateMeasure: null };
    }
    const warmCand = await measureSql(connection, candidateSql, { timeoutSec });
    if (warmCand.status !== 'ok') {
      return { status: warmCand.status, originalMeasure: warmOrig, candidateMeasure: warmCand };
    }

    const origMeasures = [];
    const candMeasures = [];
    for (let i = 0; i < runs; i += 1) {
      const orig = await measureSql(connection, caseData.original_sql, { timeoutSec });
      if (orig.status !== 'ok') {
        return { status: orig.status, originalMeasure: orig, candidateMeasure: candMeasures[candMeasures.length - 1] || null };
      }
      origMeasures.push(orig);
      const cand = await measureSql(connection, candidateSql, { timeoutSec });
      if (cand.status !== 'ok') {
        return { status: cand.status, originalMeasure: summarizeMeasures(origMeasures), candidateMeasure: cand };
      }
      candMeasures.push(cand);
    }

    const originalMeasure = summarizeMeasures(origMeasures);
    const candidateMeasure = summarizeMeasures(candMeasures);
    return {
      status: 'ok',
      resultEqual: hashRows(candidateMeasure.rows) === hashRows(originalMeasure.rows),
      bufferGets: candidateMeasure.bufferGets,
      cost: candidateMeasure.cost,
      elapsedSec: candidateMeasure.elapsedSec,
      originalMeasure,
      candidateMeasure,
    };
  } finally {
    if (connection) {
      try { await connection.close(); } catch { /* 무시 */ }
    }
  }
}
