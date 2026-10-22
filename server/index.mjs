// o-tune Oracle 로컬 백엔드 에이전트
//
// 역할:
// - 브라우저는 Oracle에 직접 접속할 수 없으므로, 같은 PC에서 실행되는 이 에이전트가 대신 접속한다.
// - 127.0.0.1에만 바인딩하고, 고정된 조회 쿼리만 실행한다 (임의 SQL 실행 API는 제공하지 않음).
// - DB 비밀번호는 요청 처리 중에만 사용하고 저장·기록하지 않는다.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import oracledb from 'oracledb';
import {
  ValidationError,
  buildConnectString,
  calculateBufferCacheHitRatio,
  clampLimit,
  mapTopSqlRows,
  sanitizeOracleError,
  toNumber,
  validateConnectionConfig,
} from './oracleData.mjs';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false;

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

const TOP_SQL = `
  SELECT st.sql_id AS "sqlId",
         st.sql_text AS "sqlText",
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

async function readJsonBody(req) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    const err = new Error('Content-Type은 application/json이어야 합니다.');
    err.status = 415;
    throw err;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
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
