import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LmError,
  buildLmMessages,
  diagnoseWithLmStudio,
  normalizeLmServerUrl,
  parseLmChatResponse,
  pickModel,
} from '../server/lmStudio.mjs';

test('LM 주소 검증: localhost만 허용하고 외부 주소는 차단한다', () => {
  assert.equal(normalizeLmServerUrl('http://localhost:1234/', {}), 'http://localhost:1234');
  assert.equal(normalizeLmServerUrl('http://127.0.0.1:1234', {}), 'http://127.0.0.1:1234');
  assert.equal(normalizeLmServerUrl(undefined, {}), 'http://127.0.0.1:1234');
  assert.throws(() => normalizeLmServerUrl('http://192.168.1.50:1234', {}), LmError);
  assert.throws(() => normalizeLmServerUrl('https://example.com:1234', {}), LmError);
  assert.throws(() => normalizeLmServerUrl('not a url', {}), LmError);
});

test('모델 선택: 요청 모델이 로드 목록에 없으면 첫 로드 모델을 쓰고, 없으면 null', () => {
  assert.equal(pickModel('a/model', ['a/model', 'b/model']), 'a/model');
  assert.equal(pickModel('없는모델', ['a/model', 'b/model']), 'a/model');
  assert.equal(pickModel('', ['a/model']), 'a/model');
  assert.equal(pickModel('a/model', []), null);
});

test('응답 파싱: JSON, 코드펜스, reasoning_content를 처리하고 tunedSql이 없으면 오류', () => {
  const diag = {
    summary: '총평', antiPatterns: [], recommendedHints: [],
    tunedSql: 'SELECT 1 FROM dual', benefitRatioPercent: 50,
  };
  const plain = parseLmChatResponse({ choices: [{ message: { content: JSON.stringify(diag) } }] });
  assert.equal(plain.tunedSql, 'SELECT 1 FROM dual');
  const fenced = parseLmChatResponse({ choices: [{ message: { content: '```json\n' + JSON.stringify(diag) + '\n```' } }] });
  assert.equal(fenced.benefitRatioPercent, 50);
  const reasoning = parseLmChatResponse({ choices: [{ message: { content: '', reasoning_content: JSON.stringify(diag) } }] });
  assert.equal(reasoning.summary, '총평');
  assert.throws(() => parseLmChatResponse({ choices: [{ message: { content: '{"summary":"x"}' } }] }), /tunedSql/);
  assert.throws(() => parseLmChatResponse({ choices: [{ message: { content: '' } }] }), LmError);
  assert.throws(() => parseLmChatResponse({ choices: [{ message: { content: '그냥 텍스트' } }] }), LmError);
});

function stubFetch({ models = ['test/model-1'], chatBody = null, chatStatus = 200 } = {}) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/v1/models')) {
      return { ok: true, status: 200, json: async () => ({ data: models.map((id) => ({ id })) }), text: async () => '' };
    }
    return {
      ok: chatStatus === 200, status: chatStatus,
      json: async () => chatBody,
      text: async () => (chatBody ? '' : 'stub error'),
    };
  };
  impl.calls = calls;
  return impl;
}

test('진단 호출: 로드 모델로 chat을 호출하고 결과를 돌려준다', async () => {
  const diag = { summary: 's', tunedSql: 'SELECT /*+ INDEX(e i) */ 1 FROM dual', benefitRatioPercent: 10 };
  const fetchImpl = stubFetch({ chatBody: { choices: [{ message: { content: JSON.stringify(diag) } }] } });
  const result = await diagnoseWithLmStudio(
    { serverUrl: 'http://127.0.0.1:1234', model: '요청했지만없는모델', rawSql: 'SELECT 1 FROM dual', executionPlanText: 'plan' },
    { fetchImpl, env: {} },
  );
  assert.equal(result.modelUsed, 'test/model-1');
  assert.equal(result.tunedSql, diag.tunedSql);
  const chatCall = fetchImpl.calls.find((c) => c.url.endsWith('/v1/chat/completions'));
  const sent = JSON.parse(chatCall.options.body);
  assert.equal(sent.model, 'test/model-1');
  assert.equal(sent.stream, false);
  assert.ok(sent.messages[1].content.includes('SELECT 1 FROM dual'));
});

test('진단 호출: 모델이 없으면 LM_NO_MODEL, 서버가 꺼져 있으면 LM_UNREACHABLE', async () => {
  const noModel = stubFetch({ models: [] });
  await assert.rejects(
    diagnoseWithLmStudio({ rawSql: 'SELECT 1 FROM dual', executionPlanText: '' }, { fetchImpl: noModel, env: {} }),
    (e) => e instanceof LmError && e.code === 'LM_NO_MODEL',
  );
  const down = async () => { throw new Error('connect ECONNREFUSED'); };
  await assert.rejects(
    diagnoseWithLmStudio({ rawSql: 'SELECT 1 FROM dual', executionPlanText: '' }, { fetchImpl: down, env: {} }),
    (e) => e instanceof LmError && e.code === 'LM_UNREACHABLE',
  );
});

test('프롬프트 구성: SQL과 실행계획이 user 메시지에 들어간다', () => {
  const messages = buildLmMessages('SELECT * FROM emp', 'PLAN TEXT');
  assert.equal(messages[0].role, 'system');
  assert.ok(messages[1].content.includes('SELECT * FROM emp'));
  assert.ok(messages[1].content.includes('PLAN TEXT'));
});
