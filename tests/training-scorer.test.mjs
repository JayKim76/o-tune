import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeHints,
  computeReward,
  hashRows,
  isSelectOnly,
  parseDiagnosis,
  scoreCandidate,
} from '../training/scorer/scorer.mjs';
import { median, parsePlanStats } from '../training/scorer/oracleRunner.mjs';
import { buildCases } from '../training/cases/templates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../training/cases/data');

test('SELECT 전용 가드: 허용과 차단을 구분한다', () => {
  assert.equal(isSelectOnly('SELECT * FROM emp WHERE sal > 100'), true);
  assert.equal(isSelectOnly('WITH t AS (SELECT 1 FROM dual) SELECT * FROM t'), true);
  assert.equal(isSelectOnly("SELECT * FROM t WHERE note = 'DELETE 이력'"), true); // 리터럴 속 키워드는 허용
  assert.equal(isSelectOnly('DELETE FROM emp WHERE 1 = 1'), false);
  assert.equal(isSelectOnly('SELECT 1 FROM dual; DROP TABLE emp'), false);
  assert.equal(isSelectOnly('SELECT * INTO backup FROM emp'), false);
  assert.equal(isSelectOnly('UPDATE emp SET sal = 1'), false);
});

test('힌트 분석: 상충, 개수, 남용을 탐지한다', () => {
  const conflict = analyzeHints('SELECT /*+ USE_HASH(e) USE_NL(d) */ * FROM emp e');
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.count, 2);
  const abuse = analyzeHints('SELECT /*+ MATERIALIZE */ * FROM emp');
  assert.equal(abuse.abuse, true);
  const ok = analyzeHints('SELECT /*+ INDEX(e idx) LEADING(e d) */ * FROM emp e');
  assert.equal(ok.conflict, false);
  assert.equal(ok.count, 2);
});

test('진단 JSON 파싱: tuned_sql이 없으면 무효', () => {
  assert.equal(parseDiagnosis({ tuned_sql: 'SELECT 1 FROM dual' }).valid, true);
  assert.equal(parseDiagnosis('{"tuned_sql":"SELECT 1 FROM dual"}').valid, true);
  assert.equal(parseDiagnosis('{"summary":"x"}').valid, false);
  assert.equal(parseDiagnosis('not json').valid, false);
});

test('결과 해시: 행 순서와 무관하고 값 변경은 탐지한다', () => {
  const a = hashRows([[1, 'a'], [2, 'b']]);
  const b = hashRows([[2, 'b'], [1, 'a']]);
  const c = hashRows([[1, 'a'], [2, 'c']]);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

const baseInput = {
  status: 'ok', resultEqual: true, diagnosisValid: true, hasRiskNotes: true,
  hints: { conflict: false, count: 1, abuse: false },
  orig: { bufferGets: 1000, cost: 1000, elapsedSec: 10 },
  cand: { bufferGets: 100, cost: 100, elapsedSec: 1 },
};

test('보상: 큰 개선은 1.0, 무개선은 보너스만, 실패는 음수', () => {
  assert.equal(computeReward(baseInput).reward, 1);
  const noImprove = computeReward({ ...baseInput, hasRiskNotes: false, cand: { ...baseInput.orig } });
  assert.equal(noImprove.reward, 0.05);
  assert.equal(computeReward({ ...baseInput, status: 'error' }).reward, -1);
  assert.equal(computeReward({ ...baseInput, resultEqual: false }).reward, -1);
  assert.equal(computeReward({ ...baseInput, status: 'timeout' }).reward, -0.2);
  assert.equal(computeReward({ ...baseInput, diagnosisValid: false }).reward, -0.5);
});

test('보상: 상충 힌트와 남용 감점이 적용된다', () => {
  const conflict = computeReward({ ...baseInput, hasRiskNotes: false, hints: { conflict: true, count: 2, abuse: false } });
  assert.equal(conflict.reward, 0.75); // 0.9 + 0.05 - 0.2
  const abuse = computeReward({
    ...baseInput, hasRiskNotes: false, cand: { ...baseInput.orig },
    hints: { conflict: false, count: 8, abuse: true },
  });
  assert.equal(abuse.reward, -0.31); // 0 + 0.05 - 0.06 - 0.3
});

test('scoreCandidate: DML은 실행 전에 차단되고, 행 기반 동등성을 판정한다', () => {
  const caseData = {
    original_sql: 'SELECT 1 FROM dual',
    original_metrics: { buffer_gets: 100, cost: 10, elapsed_sec: 1 },
    orig_result_hash: hashRows([[1, 'a'], [2, 'b']]),
  };
  const blocked = scoreCandidate({
    caseData,
    candidate: { diagnosis: { tuned_sql: 'DELETE FROM emp' } },
    execution: { status: 'ok', resultEqual: true, bufferGets: 1, cost: 1, elapsedSec: 0.1 },
  });
  assert.equal(blocked.verdict, 'BLOCKED_NOT_SELECT');
  assert.equal(blocked.reward, -1);

  const equal = scoreCandidate({
    caseData,
    candidate: { diagnosis: { tuned_sql: 'SELECT 1 FROM dual', risk_notes: 'x' } },
    execution: { status: 'ok', rows: [[2, 'b'], [1, 'a']], bufferGets: 50, cost: 5, elapsedSec: 0.5 },
  });
  assert.equal(equal.verdict, 'SCORED');

  const mismatch = scoreCandidate({
    caseData,
    candidate: { diagnosis: { tuned_sql: 'SELECT 1 FROM dual' } },
    execution: { status: 'ok', rows: [[9, 'z']], bufferGets: 50, cost: 5, elapsedSec: 0.5 },
  });
  assert.equal(mismatch.verdict, 'RESULT_MISMATCH');
  assert.equal(mismatch.reward, -1);
});

test('parsePlanStats: 헤더 위치 기반으로 Buffers 합계와 Cost를 읽는다', () => {
  const plan = [
    '| Id  | Operation          | Name | Rows | Bytes | Cost (%CPU)| Time     | Starts | E-Rows | A-Rows | Buffers | Reads |',
    '|   0 | SELECT STATEMENT   |      |      |       |  100 (1)   | 00:00:01 |      1 |        |    100 |     250 |    10 |',
    '|   1 |  TABLE ACCESS FULL | EMP  |      |       |   90 (1)   | 00:00:01 |      1 |        |    100 |     250 |    10 |',
  ].join('\n');
  const stats = parsePlanStats(plan);
  assert.equal(stats.bufferGets, 500);
  assert.equal(stats.cost, 100);
  assert.equal(median([3, 1, 2]), 2);
});

test('케이스 생성: 100건, 고유 ID, 정답 지표가 원본보다 좋다', () => {
  const cases = buildCases();
  assert.equal(cases.length, 100);
  assert.equal(new Set(cases.map((c) => c.case_id)).size, 100);
  for (const c of cases) {
    assert.ok(c.gold_metrics.buffer_gets < c.original_metrics.buffer_gets, c.case_id);
    assert.ok(c.diagnosis.anti_patterns.length > 0, c.case_id);
    assert.equal(c.review.verdict, 'pending');
    assert.equal(c.metrics_basis, 'estimated');
  }
});

test('생성된 케이스 파일이 디스크에도 100건 있다', async () => {
  const files = (await readdir(dataDir)).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 100);
  const first = JSON.parse(await readFile(path.join(dataDir, 'case-0001.json'), 'utf8'));
  assert.equal(first.case_id, buildCases()[0].case_id);
  assert.equal(first.original_sql, buildCases()[0].original_sql);
});
