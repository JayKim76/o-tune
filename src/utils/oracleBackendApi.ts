// 로컬 Oracle 백엔드 에이전트(server/index.mjs) 클라이언트.
// 개발 모드에서는 Vite 프록시(/oracle-api)가 127.0.0.1:8787로 전달하고,
// 프로덕션에서는 에이전트가 빌드된 화면과 API를 함께 제공한다.

import type {
  OracleConnectionConfig,
  OracleConnectionTestResult,
  OracleDashboardResponse,
  OracleTopSqlRow,
  TopSqlItem,
  DashboardMetrics,
} from '../types/oracle';
import { analyzeAntiPatterns, generateTunedSql, normalizeSql } from './sqlParser';

const AGENT_UNREACHABLE_MESSAGE =
  '로컬 백엔드 에이전트에 연결할 수 없습니다. 프로젝트 폴더에서 npm run server를 먼저 실행해 주세요.';

function connectionPayload(config: OracleConnectionConfig) {
  return {
    host: config.host,
    port: config.port,
    serviceName: config.serviceName,
    username: config.username,
    password: config.password || '',
    useDrcp: config.useDrcp,
  };
}

async function postJson<T>(path: string, config: OracleConnectionConfig, extra: Record<string, unknown> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-O-Tune-Client': 'web',
        ...(config.agentToken ? { 'X-O-Tune-Token': config.agentToken } : {}),
      },
      body: JSON.stringify({ connection: connectionPayload(config), ...extra }),
    });
  } catch {
    throw new Error(AGENT_UNREACHABLE_MESSAGE);
  }

  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(data?.error || `백엔드 요청이 실패했습니다. (HTTP ${response.status})`);
  }
  return data as T;
}

export async function checkOracleAgent(): Promise<boolean> {
  try {
    const response = await fetch('/oracle-api/health', { headers: { 'X-O-Tune-Client': 'web' } });
    return response.ok;
  } catch {
    return false;
  }
}

export async function testOracleConnection(
  config: OracleConnectionConfig,
): Promise<OracleConnectionTestResult> {
  return postJson<OracleConnectionTestResult>('/oracle-api/connection-test', config);
}

function enrichRow(row: OracleTopSqlRow): TopSqlItem {
  const plan = row.executionPlan || '';
  const antiPatterns = analyzeAntiPatterns(row.sqlText, plan);
  const hints = [...new Set(antiPatterns.flatMap((ap) => ap.suggestedHints))];
  const normalized = normalizeSql(row.sqlText);
  return {
    ...row,
    normalizedSql: normalized.normalizedSql,
    antiPatterns,
    tunedSql: hints.length > 0 ? generateTunedSql(normalized.normalizedSql, hints) : undefined,
    // 튜닝 후 실행계획은 여기서 만들지 않는다. Plan Diff 화면에서 EXPLAIN PLAN으로
    // 실행 없이 만든 예상 계획을 별도 조회한다 (실행한 실제 계획과는 구분 표기).
    tunedPlan: undefined,
    executionPlan: plan || '백엔드에서 실행계획을 가져오지 못했습니다. DBMS_XPLAN.DISPLAY_CURSOR 권한과 커서 상태를 확인하세요.',
  };
}

/** 튜닝 SQL을 실행하지 않고 EXPLAIN PLAN으로 예상 실행계획만 받아 온다. */
export async function fetchExplainPlan(
  config: OracleConnectionConfig,
  sql: string,
): Promise<{ planText: string; statementId: string; estimated: boolean }> {
  return postJson('/oracle-api/explain-plan', config, { sql });
}

export async function fetchLiveDashboard(
  config: OracleConnectionConfig,
  limit = 10,
): Promise<{ items: TopSqlItem[]; metrics: DashboardMetrics; fetchedAt: string; warnings: string[] }> {
  const data = await postJson<OracleDashboardResponse>('/oracle-api/dashboard', config, { limit });
  return {
    items: data.items.map(enrichRow),
    metrics: data.metrics,
    fetchedAt: data.fetchedAt,
    warnings: data.warnings || [],
  };
}
