// o-tune Oracle 로컬 백엔드 에이전트
//
// 역할:
// - 브라우저는 Oracle에 직접 접속할 수 없으므로, 같은 PC에서 실행되는 이 에이전트가 대신 접속한다.
// - 127.0.0.1에만 바인딩하고, 고정된 조회 쿼리만 실행한다 (임의 SQL 실행 API는 제공하지 않음).
//   유일한 예외는 EXPLAIN PLAN 전용 엔드포인트로, SELECT 문장만 받아 실행 없이 예상 계획만 만든다.
// - DB 비밀번호는 요청 처리 중에만 사용하고 저장·기록하지 않는다.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import oracledb from 'oracledb';
import {
  EXPLAIN_PLAN_CLEANUP_SQL,
  EXPLAIN_PLAN_TABLE_SQL,
  ValidationError,
  buildConnectString,
  buildExplainPlanSql,
  calculateBufferCacheHitRatio,
  cleanExplainTargetSql,
  clampLimit,
  extractBindNames,
  mapTopSqlRows,
  planRowsToText,
  sanitizeOracleError,
  sanitizeSqlForExplain,
  toNumber,
  validateConnectionConfig,
} from './oracleData.mjs';
import { isSelectOnly, stripForGuard } from '../training/scorer/scorer.mjs';
import {
  LmError,
  diagnoseWithLmStudio,
  fetchLmModels,
  normalizeLmServerUrl,
} from './lmStudio.mjs';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false;
// SQL_FULLTEXT는 CLOB이다. Lob 객체가 아니라 문자열로 받아야
// mapTopSqlRows의 String 변환에서 깨지지 않는다.
oracledb.fetchAsString = [oracledb.CLOB];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PORT = Number(process.env.OTUNE_API_PORT || 8787);
const HOST = '127.0.0.1';
const API_TOKEN = process.env.OTUNE_API_TOKEN || '';
const MAX_BODY_BYTES = 32 * 1024;

const TEST_SQL = `
  SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS "databaseName",
         SYS_CONTEXT('USERENV', 'SERVICE_NAME') AS "serviceName",
         SYS_CONTEXT('USERENV', 'CURRENT_USER') AS "currentUser"
    FROM dual`;

const VERSION_SQL = `SELECT version AS "version" FROM v$instance`;

// sql_text는 앞 1,000자에서 잘리므로 전체 본문인 sql_fulltext(CLOB)를 쓴다.
// 잘린 SQL을 진단/정규화에 넘기면 깨진 SQL을 튜닝하게 되기 때문이다.
const TOP_SQL = `
  SELECT st.sql_id AS "sqlId",
         st.sql_fulltext AS "sqlText",
         st.elapsed_time AS "elapsedTimeMicro",
         st.cpu_time AS "cpuTimeMicro",
         st.user_io_wait_time AS "userIoWaitTimeMicro",
         st.buffer_gets AS "bufferGets",
         st.disk_reads AS "diskReads",
         st.executions AS "executions",
         SUM(st.elapsed_time) OVER () AS "totalElapsedTimeMicro"
    FROM v$sqlstats st
   WHERE st.elapsed_time > 0
   ORDER BY st.elapsed_time DESC
   FETCH FIRST :limit ROWS ONLY`;

const PLAN_SQL = `
  SELECT plan_table_output AS "planLine"
    FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(:sqlId, 0, 'TYPICAL +PREDICATE'))`;

const ACTIVE_SESSIONS_SQL = `
  SELECT COUNT(*) AS "activeSessions"
    FROM v$session
   WHERE status = 'ACTIVE'
     AND username IS NOT NULL`;

const SYSSTAT_SQL = `
  SELECT name AS "name", value AS "value"
    FROM v$sysstat
   WHERE name IN ('physical reads cache', 'consistent gets from cache', 'db block gets from cache')`;

const INSTANCE_SQL = `SELECT startup_time AS "startupTime" FROM v$instance`;

function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const hostOk = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const portOk = url.port === '5173' || url.port === String(PORT) || url.port === '';
    return (url.protocol === 'http:' || url.protocol === 'https:') && hostOk && portOk;
  } catch {
    return false;
  }
}

function isAllowedHost(host) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host || '');
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-O-Tune-Token, X-O-Tune-Client');
  }
}

function sendJson(req, res, status, payload) {
  applyCors(req, res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function guardRequest(req, { requireToken = false } = {}) {
  if (!isAllowedHost(req.headers.host)) {
    const err = new Error('허용되지 않은 Host 요청입니다.');
    err.status = 403;
    throw err;
  }
  if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) {
    const err = new Error('허용되지 않은 Origin 요청입니다.');
    err.status = 403;
    throw err;
  }
  const clientToken = req.headers['x-o-tune-token'] || req.headers['x-otune-token'];
  if (requireToken && API_TOKEN && clientToken !== API_TOKEN) {
    const err = new Error('로컬 에이전트 토큰이 올바르지 않습니다. OTUNE_API_TOKEN과 모달의 토큰을 맞춰 주세요.');
    err.status = 401;
    throw err;
  }
}

async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    const err = new Error('Content-Type은 application/json이어야 합니다.');
    err.status = 415;
    throw err;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error('요청 본문이 너무 큽니다.');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const err = new Error('요청 JSON을 읽을 수 없습니다.');
    err.status = 400;
    throw err;
  }
}

async function withConnection(config, work) {
  let connection;
  try {
    connection = await oracledb.getConnection({
      user: config.username,
      password: config.password,
      connectString: buildConnectString(config),
    });
    return await work(connection);
  } finally {
    if (connection) {
      try { await connection.close(); } catch { /* 종료 실패는 무시 */ }
    }
  }
}

async function executeRows(connection, sql, binds = {}) {
  const result = await connection.execute(sql, binds);
  return result.rows || [];
}

async function testConnection(config) {
  const startedAt = Date.now();
  return withConnection(config, async (connection) => {
    const rows = await executeRows(connection, TEST_SQL);
    let version = null;
    try {
      const versionRows = await executeRows(connection, VERSION_SQL);
      version = versionRows[0]?.version || null;
    } catch { /* 버전 조회 권한이 없어도 연결 자체는 성공으로 본다 */ }
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      databaseName: rows[0]?.databaseName || null,
      serviceName: rows[0]?.serviceName || config.serviceName,
      currentUser: rows[0]?.currentUser || config.username,
      version,
    };
  });
}

async function fetchDashboard(config, limit) {
  return withConnection(config, async (connection) => {
    const warnings = [];
    const rows = await executeRows(connection, TOP_SQL, { limit });

    for (const row of rows) {
      try {
        const planRows = await executeRows(connection, PLAN_SQL, { sqlId: row.sqlId });
        row.executionPlan = planRows.map((r) => String(r.planLine || '')).join('\n');
        if (!row.executionPlan) warnings.push(`${row.sqlId}: 실행계획을 찾지 못했습니다.`);
      } catch {
        row.executionPlan = '';
        warnings.push(`${row.sqlId}: 실행계획 조회 권한이 없거나 계획이 만료되었습니다.`);
      }
    }

    const metrics = { activeSessions: null, bufferCacheHitRatio: null, instanceStartedAt: null };
    try {
      const sessionRows = await executeRows(connection, ACTIVE_SESSIONS_SQL);
      metrics.activeSessions = toNumber(sessionRows[0]?.activeSessions);
    } catch { warnings.push('활성 세션 수 조회에 실패했습니다.'); }

    try {
      const stats = await executeRows(connection, SYSSTAT_SQL);
      metrics.bufferCacheHitRatio = calculateBufferCacheHitRatio(stats);
      const instanceRows = await executeRows(connection, INSTANCE_SQL);
      const startup = instanceRows[0]?.startupTime;
      metrics.instanceStartedAt = startup ? new Date(startup).toISOString() : null;
    } catch { warnings.push('버퍼 캐시 지표 조회에 실패했습니다.'); }

    return {
      source: 'live',
      fetchedAt: new Date().toISOString(),
      items: mapTopSqlRows(rows),
      metrics,
      warnings,
    };
  });
}

/**
 * 튜닝 SQL을 실제로 실행하지 않고 EXPLAIN PLAN으로 예상 실행계획만 만든다.
 * - SELECT 전용 가드(학습 채점기와 동일)를 통과한 문장만 받는다.
 * - 바인드 변수는 값을 알 수 없으므로 SQL*Plus처럼 미결정(타입 없는) 상태로 설명한다.
 *   더미로 NULL 문자열 바인드를 채워 ORA-01008을 피한다.
 * - 만든 계획 행은 같은 세션에서 지운다. PLAN_TABLE은 보통 세션 전용 임시 테이블이라
 *   지우지 않아도 세션이 끝나면 사라진다.
 */
async function explainPlan(config, rawSql) {
  const sql = cleanExplainTargetSql(rawSql);
  if (!isSelectOnly(sql)) {
    const err = new Error('EXPLAIN PLAN은 SELECT 문장만 지원합니다. DML/DDL이나 다중 문장은 실행계획을 만들 수 없습니다.');
    err.status = 400;
    throw err;
  }
  const statementId = `OTUNE_${randomBytes(6).toString('hex').toUpperCase()}`;
  return withConnection(config, async (connection) => {
    const runExplain = async (targetSql) => {
      // 바인드 추출은 리터럴·주석을 제거한 텍스트에서 한다 ('12:30' 같은 리터럴 오인 방지).
      const binds = {};
      for (const name of extractBindNames(stripForGuard(targetSql))) {
        binds[name] = { val: null, type: oracledb.STRING, dir: oracledb.BIND_IN };
      }
      await connection.execute(buildExplainPlanSql(statementId, targetSql), binds);
      const planRows = await executeRows(connection, EXPLAIN_PLAN_TABLE_SQL, { statementId });
      return planRowsToText(planRows);
    };
    try {
      let planText;
      try {
        planText = await runExplain(sql);
      } catch (firstError) {
        // ORA-00921(문장 끝 예상 밖 종료)·ORA-00911은 끝에 붙은 세미콜론이나
        // 주석이 파서를 방해할 때 자주 난다. 주석 제거본으로 한 번만 다시 시도한다.
        if (!/ORA-00921|ORA-00911/.test(String(firstError?.message || ''))) throw firstError;
        const sanitized = sanitizeSqlForExplain(sql);
        if (sanitized === sql) throw firstError;
        console.warn(`[o-tune] EXPLAIN PLAN 파싱 오류로 주석 제거본 재시도: ${sanitizeOracleError(firstError)}`);
        // 첫 시도가 계획 행을 남겼을 수 있어 같은 statement_id 행을 비우고 재시도한다.
        try { await connection.execute(EXPLAIN_PLAN_CLEANUP_SQL, { statementId }); } catch { /* 무시 */ }
        planText = await runExplain(sanitized);
      }
      if (!planText) {
        const err = new Error('EXPLAIN PLAN 결과를 읽지 못했습니다. PLAN_TABLE 접근 권한을 확인해 주세요.');
        err.status = 502;
        throw err;
      }
      return { planText, statementId, estimated: true };
    } catch (error) {
      // 어느 단계에서 실패했는지와 대상 SQL의 길이·머리를 함께 남겨 원인 확인을 돕는다.
      if (error?.status !== 400 && error?.status !== 502) {
        const preview = sql.slice(0, 120).replace(/\s+/g, ' ');
        error.message = `${error.message} [대상 SQL ${sql.length}자: ${preview}...]`;
      }
      throw error;
    } finally {
      try {
        await connection.execute(EXPLAIN_PLAN_CLEANUP_SQL, { statementId });
        await connection.commit();
      } catch { /* 정리 실패는 결과에 영향을 주지 않는다 */ }
    }
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = path.resolve(DIST_DIR, requested);
  if (!filePath.startsWith(DIST_DIR)) {
    sendJson(req, res, 403, { error: '잘못된 경로입니다.' });
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    filePath = path.join(DIST_DIR, 'index.html');
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    sendJson(req, res, 404, { error: '프론트 빌드가 없습니다. 먼저 npm run build를 실행하거나 개발 서버(npm run dev)를 사용하세요.' });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS' && url.pathname.startsWith('/oracle-api')) {
      guardRequest(req);
      applyCors(req, res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/oracle-api/health' && req.method === 'GET') {
      guardRequest(req);
      sendJson(req, res, 200, {
        ok: true,
        service: 'o-tune-oracle-agent',
        oracleDriverVersion: oracledb.versionString,
        thinMode: oracledb.thin,
        tokenRequired: Boolean(API_TOKEN),
        time: new Date().toISOString(),
      });
      return;
    }

    if (url.pathname === '/oracle-api/connection-test' && req.method === 'POST') {
      guardRequest(req, { requireToken: true });
      const body = await readJsonBody(req);
      const config = validateConnectionConfig(body.connection);
      const result = await testConnection(config);
      sendJson(req, res, 200, result);
      return;
    }

    if (url.pathname === '/oracle-api/dashboard' && req.method === 'POST') {
      guardRequest(req, { requireToken: true });
      const body = await readJsonBody(req);
      const config = validateConnectionConfig(body.connection);
      const result = await fetchDashboard(config, clampLimit(body.limit, 10));
      sendJson(req, res, 200, result);
      return;
    }

    if (url.pathname === '/oracle-api/explain-plan' && req.method === 'POST') {
      guardRequest(req, { requireToken: true });
      const body = await readJsonBody(req, 128 * 1024);
      const config = validateConnectionConfig(body.connection ?? body);
      const result = await explainPlan(config, body.sql);
      sendJson(req, res, 200, result);
      return;
    }

    // LM Studio 상태: 에이전트가 서버 쪽에서 조회한다 (브라우저 CORS와 무관).
    if (url.pathname === '/oracle-api/lm-status' && req.method === 'GET') {
      guardRequest(req);
      const baseUrl = normalizeLmServerUrl(url.searchParams.get('serverUrl') || undefined);
      try {
        const models = await fetchLmModels(baseUrl);
        sendJson(req, res, 200, { ok: true, isOnline: true, models, serverUrl: baseUrl });
      } catch (error) {
        if (error instanceof LmError) {
          sendJson(req, res, 200, { ok: true, isOnline: false, models: [], serverUrl: baseUrl, error: error.message, code: error.code });
          return;
        }
        throw error;
      }
      return;
    }

    // LM Studio 진단 프록시: 브라우저가 localhost:1234를 직접 부르지 않는다.
    // 토큰 대신 Origin/Host 가드로 보호한다 (health와 같은 수준).
    if (url.pathname === '/oracle-api/lm-diagnose' && req.method === 'POST') {
      guardRequest(req);
      const body = await readJsonBody(req, 256 * 1024);
      const rawSql = typeof body.sql === 'string' ? body.sql : '';
      const executionPlanText = typeof body.executionPlan === 'string' ? body.executionPlan : '';
      if (!rawSql.trim()) {
        const err = new Error('진단할 SQL이 비어 있습니다.');
        err.status = 400;
        throw err;
      }
      const result = await diagnoseWithLmStudio({
        serverUrl: typeof body.serverUrl === 'string' ? body.serverUrl : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
        rawSql,
        executionPlanText,
      });
      sendJson(req, res, 200, result);
      return;
    }

    if (url.pathname.startsWith('/oracle-api')) {
      sendJson(req, res, 404, { error: '알 수 없는 API 경로입니다.' });
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res, url.pathname);
      return;
    }

    sendJson(req, res, 405, { error: '지원하지 않는 메서드입니다.' });
  } catch (error) {
    if (error instanceof LmError) {
      // LM 오류 메시지는 사용자에게 그대로 보여 줘도 되는 안내 문구다.
      sendJson(req, res, error.status, { error: error.message, code: error.code });
      return;
    }
    const status = error instanceof ValidationError
      ? error.status
      : (Number.isInteger(error?.status) ? error.status : 502);
    sendJson(req, res, status, { error: sanitizeOracleError(error) });
  }
});

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  server.listen(PORT, HOST, () => {
    console.log(`[o-tune] Oracle 로컬 에이전트 실행 중: http://${HOST}:${PORT}`);
    console.log(`[o-tune] 상태 확인: http://${HOST}:${PORT}/oracle-api/health`);
    console.log(`[o-tune] Oracle 드라이버 ${oracledb.versionString} (Thin 모드: ${oracledb.thin})`);
    if (API_TOKEN) console.log('[o-tune] OTUNE_API_TOKEN 인증이 활성화되어 있습니다.');
  });
}
