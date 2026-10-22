// 샌드박스 Oracle 실행 러너.
// 전제: 샌드박스 스키마(DDL+통계)는 케이스별로 미리 준비되어 있고,
// 접속 계정은 SELECT 전용이다. 접속 정보는 환경변수로만 받는다.
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
 * elapsed는 3회 실행 중앙값, 나머지는 마지막 실행 기준.
 * 반환값은 scorer.scoreCandidate의 execution 형태와 호환된다.
 */
export async function runCaseInSandbox(caseData, candidateSql, config, { timeoutSec = 30, runs = 3 } = {}) {
  let connection;
  try {
    connection = await oracledb.getConnection(config);

    const origRuns = [];
    let origLast = null;
    for (let i = 0; i < runs; i += 1) {
      origLast = await measureSql(connection, caseData.original_sql, { timeoutSec });
      if (origLast.status !== 'ok') break;
      origRuns.push(origLast.elapsedSec);
    }
    if (!origLast || origLast.status !== 'ok') {
      return { status: origLast?.status || 'error', originalMeasure: origLast, candidateMeasure: null };
    }
    const originalHash = hashRows(origLast.rows);

    const candRuns = [];
    let candLast = null;
    for (let i = 0; i < runs; i += 1) {
      candLast = await measureSql(connection, candidateSql, { timeoutSec });
      if (candLast.status !== 'ok') break;
      candRuns.push(candLast.elapsedSec);
    }
    if (!candLast || candLast.status !== 'ok') {
      return { status: candLast?.status || 'error', originalMeasure: origLast, candidateMeasure: candLast };
    }

    return {
      status: 'ok',
      resultEqual: hashRows(candLast.rows) === originalHash,
      bufferGets: candLast.bufferGets,
      cost: candLast.cost,
      elapsedSec: median(candRuns),
      originalMeasure: { ...origLast, elapsedSec: median(origRuns) },
      candidateMeasure: candLast,
    };
  } finally {
    if (connection) {
      try { await connection.close(); } catch { /* 무시 */ }
    }
  }
}
