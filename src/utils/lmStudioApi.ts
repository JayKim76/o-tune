import type { LmStudioConfig, LmStudioDiagnosticResult } from '../types/oracle';

export const DEFAULT_LM_STUDIO_URL = 'http://localhost:1234';

const AGENT_UNREACHABLE_MESSAGE =
  '로컬 백엔드 에이전트에 연결할 수 없습니다. 프로젝트 폴더에서 npm run server를 먼저 실행해 주세요. LM Studio 호출은 에이전트를 경유합니다.';

/**
 * LM Studio 상태 확인. 브라우저가 localhost:1234를 직접 부르면 CORS와
 * 운영 모드(에이전트 정적 제공) 문제로 깨지므로, 에이전트 프록시를 경유한다.
 */
export async function checkLmStudioStatus(serverUrl: string = DEFAULT_LM_STUDIO_URL): Promise<{
  isOnline: boolean;
  models: string[];
  connectedUrl?: string;
  error?: string;
}> {
  try {
    const query = `?serverUrl=${encodeURIComponent(serverUrl)}`;
    const response = await fetch(`/oracle-api/lm-status${query}`, {
      headers: { 'X-O-Tune-Client': 'web' },
    });
    if (!response.ok) return { isOnline: false, models: [] };
    const data = (await response.json()) as {
      isOnline?: boolean; models?: string[]; serverUrl?: string; error?: string;
    };
    return {
      isOnline: Boolean(data.isOnline),
      // 서버가 반환한 모델만 표시한다. 목록이 비면 비어 있는 대로 둔다 (모델명을 지어내지 않음).
      models: Array.isArray(data.models) ? data.models : [],
      connectedUrl: data.serverUrl,
      error: data.error,
    };
  } catch {
    return { isOnline: false, models: [], error: AGENT_UNREACHABLE_MESSAGE };
  }
}

/**
 * LM Studio 로컬 AI 진단. 에이전트 프록시(/oracle-api/lm-diagnose)가
 * 실제 로드된 모델로 LM Studio를 호출하고 JSON 응답을 검증해 돌려준다.
 * 실패하면 예시 결과를 만들지 않고 이유를 담은 오류를 던진다.
 * 호출자(SqlDiagnoser)가 오류를 표시하고 Rule Engine으로 폴백한다.
 */
export async function analyzeSqlWithLmStudio(
  rawSql: string,
  executionPlanText: string,
  config: LmStudioConfig
): Promise<LmStudioDiagnosticResult> {
  let response: Response;
  try {
    response = await fetch('/oracle-api/lm-diagnose', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-O-Tune-Client': 'web',
      },
      body: JSON.stringify({
        serverUrl: config.serverUrl,
        model: config.activeModel || undefined,
        sql: rawSql,
        executionPlan: executionPlanText,
      }),
    });
  } catch {
    throw new Error(AGENT_UNREACHABLE_MESSAGE);
  }

  const data = (await response.json().catch(() => null)) as
    | (LmStudioDiagnosticResult & { error?: string })
    | null;
  if (!response.ok || !data || data.error) {
    throw new Error(data?.error || `LM Studio 진단 요청이 실패했습니다. (HTTP ${response.status})`);
  }
  return data;
}
