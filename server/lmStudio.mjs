// LM Studio 로컬 AI 프록시 모듈.
// 브라우저가 LM Studio(localhost:1234)를 직접 호출하면 CORS 설정에 막히고,
// 운영 모드(에이전트가 화면을 함께 제공)에서는 Vite 프록시도 없어 호출이 깨진다.
// 그래서 에이전트가 서버 쪽에서 대신 호출한다. 순수 함수와 fetch 주입이 가능해
// 단위 테스트로 검증할 수 있다.

export const DEFAULT_LM_SERVER_URL = 'http://127.0.0.1:1234';
export const LM_DIAGNOSE_TIMEOUT_MS = 120_000;
export const LM_STATUS_TIMEOUT_MS = 3_000;

export class LmError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LmError';
    this.code = code;
    this.status = 502;
  }
}

/**
 * LM Studio 주소 검증. 에이전트가 임의 주소로 요청을 중계하면 SSRF가 되므로
 * localhost / 127.0.0.1 / ::1 만 허용한다.
 */
export function normalizeLmServerUrl(rawUrl, env = process.env) {
  const candidate = String(rawUrl || env.OTUNE_LM_URL || DEFAULT_LM_SERVER_URL).trim();
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new LmError('LM_URL_INVALID', `LM Studio 주소 형식이 올바르지 않습니다: ${candidate}`);
  }
  const hostOk = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !hostOk) {
    throw new LmError('LM_URL_INVALID', 'LM Studio 주소는 이 PC의 localhost 주소만 허용됩니다.');
  }
  return candidate.replace(/\/+$/, '');
}

/** 요청 모델이 로드 목록에 있으면 그것을, 없으면 첫 번째 로드 모델을 쓴다. 지어내지 않는다. */
export function pickModel(requested, availableModels) {
  const models = Array.isArray(availableModels) ? availableModels.filter((m) => typeof m === 'string' && m) : [];
  if (models.length === 0) return null;
  if (requested && models.includes(requested)) return requested;
  return models[0];
}

export function buildLmMessages(rawSql, executionPlanText) {
  const systemPrompt = `You are a world-class Oracle DBA. Analyze the provided Oracle SQL and DBMS_XPLAN execution plan.
Respond ONLY in JSON format:
{
  "summary": "종합 튜닝 총평 (한글)",
  "antiPatterns": [
    {
      "type": "FULL_TABLE_SCAN",
      "title": "안티패턴 제목 (한글)",
      "detectedLogic": "원인 설명 (한글)",
      "recommendation": "권고사항 (한글)",
      "suggestedHints": ["/*+ INDEX(...) */"],
      "severity": "HIGH"
    }
  ],
  "recommendedHints": ["/*+ LEADING(e d) USE_NL(d) */"],
  "tunedSql": "튜닝된 오라클 SQL 문장",
  "originalPlanAnalysis": "기존 실행계획 문제점 (한글)",
  "tunedPlanAnalysis": "튜닝 후 예상 실행계획 개선점 (한글)",
  "estimatedCostReduction": "Cost 1,240 -> Cost 12 (-99.0%)",
  "benefitRatioPercent": 99
}`;
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `[Oracle SQL]\n${rawSql}\n\n[DBMS_XPLAN]\n${executionPlanText}` },
  ];
}

function extractJsonText(rawText) {
  const text = String(rawText || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return text.substring(start, end + 1);
  return text;
}

/**
 * LM Studio chat 응답 본문에서 진단 결과를 만든다.
 * 파싱에 실패하면 예시 결과를 지어내지 않고 LM_INVALID_RESPONSE 오류를 던진다.
 */
export function parseLmChatResponse(resData) {
  const message = resData?.choices?.[0]?.message || {};
  // 추론형 모델은 content가 비고 reasoning_content에만 본문이 있는 경우가 있다.
  const contentText = String(message.content || message.reasoning_content || '').trim();
  if (!contentText) {
    throw new LmError('LM_INVALID_RESPONSE', 'LM Studio가 빈 응답을 반환했습니다. 모델이 로드되어 있는지 확인해 주세요.');
  }
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(contentText));
  } catch {
    throw new LmError('LM_INVALID_RESPONSE', 'LM Studio 응답을 JSON으로 해석하지 못했습니다. 더 큰 모델이나 JSON 응답에 강한 모델로 다시 시도해 주세요.');
  }
  if (typeof parsed?.tunedSql !== 'string' || parsed.tunedSql.trim() === '') {
    throw new LmError('LM_INVALID_RESPONSE', 'LM Studio 응답에 tunedSql이 없습니다. 모델 응답 형식이 올바르지 않습니다.');
  }
  const antiPatterns = Array.isArray(parsed.antiPatterns)
    ? parsed.antiPatterns.map((item) => ({
        type: item?.type || 'FULL_TABLE_SCAN',
        title: item?.title || '안티패턴 감지',
        detectedLogic: item?.detectedLogic || '성능 저하 요인이 감지되었습니다.',
        recommendation: item?.recommendation || '인덱스 재구성 및 힌트 주입을 검토하십시오.',
        suggestedHints: Array.isArray(item?.suggestedHints) ? item.suggestedHints : [],
        severity: ['HIGH', 'MEDIUM', 'LOW'].includes(item?.severity) ? item.severity : 'HIGH',
      }))
    : [];
  return {
    summary: parsed.summary || 'LM Studio 로컬 AI 튜닝 분석 결과가 생성되었습니다.',
    antiPatterns,
    recommendedHints: Array.isArray(parsed.recommendedHints) ? parsed.recommendedHints : [],
    tunedSql: parsed.tunedSql,
    originalPlanAnalysis: parsed.originalPlanAnalysis || '',
    tunedPlanAnalysis: parsed.tunedPlanAnalysis || '',
    estimatedCostReduction: parsed.estimatedCostReduction || '',
    benefitRatioPercent: typeof parsed.benefitRatioPercent === 'number' ? parsed.benefitRatioPercent : 0,
    rawModelResponse: contentText,
  };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new LmError('LM_TIMEOUT', `LM Studio가 ${Math.round(timeoutMs / 1000)}초 안에 응답하지 않았습니다. 모델 로딩 상태와 PC 부하를 확인해 주세요.`);
    }
    throw new LmError('LM_UNREACHABLE', 'LM Studio 서버에 연결할 수 없습니다. LM Studio 앱에서 모델을 로드하고 Local Server가 켜져 있는지 확인해 주세요. (기본 주소 http://localhost:1234)');
  } finally {
    clearTimeout(timer);
  }
}

/** 로드된 모델 목록 조회. 서버가 꺼져 있으면 LmError를 던진다. */
export async function fetchLmModels(baseUrl, { fetchImpl = fetch, timeoutMs = LM_STATUS_TIMEOUT_MS } = {}) {
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/v1/models`, { method: 'GET' }, timeoutMs);
  if (!response.ok) {
    throw new LmError('LM_UNREACHABLE', `LM Studio 모델 목록 조회가 실패했습니다. (HTTP ${response.status})`);
  }
  const data = await response.json().catch(() => null);
  return (Array.isArray(data?.data) ? data.data : []).map((m) => m?.id).filter((id) => typeof id === 'string' && id);
}

/** 진단 실행: 모델 목록을 먼저 확인해 실제 로드된 모델로만 호출한다. */
export async function diagnoseWithLmStudio({ serverUrl, model, rawSql, executionPlanText }, { fetchImpl = fetch, env = process.env, timeoutMs = LM_DIAGNOSE_TIMEOUT_MS } = {}) {
  const baseUrl = normalizeLmServerUrl(serverUrl, env);
  const models = await fetchLmModels(baseUrl, { fetchImpl });
  const modelToUse = pickModel(model, models);
  if (!modelToUse) {
    throw new LmError('LM_NO_MODEL', 'LM Studio에 로드된 모델이 없습니다. LM Studio에서 모델을 먼저 로드해 주세요.');
  }
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelToUse,
      messages: buildLmMessages(rawSql, executionPlanText),
      temperature: 0.1,
      max_tokens: 4096,
      stream: false,
    }),
  }, timeoutMs);
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new LmError('LM_HTTP_ERROR', `LM Studio 진단 요청이 실패했습니다. (HTTP ${response.status}) ${bodyText.slice(0, 200)}`.trim());
  }
  const data = await response.json().catch(() => null);
  if (!data) throw new LmError('LM_INVALID_RESPONSE', 'LM Studio 응답 본문을 읽지 못했습니다.');
  return { ...parseLmChatResponse(data), modelUsed: modelToUse };
}
