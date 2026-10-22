// 케이스 전체 배치 평가 (드라이런 모드).
// 케이스마다 후보 3종을 채점해 채점기의 판정 일관성을 검증한다.
//   gold  : 케이스의 정답 튜닝 SQL + 정답 지표 → 높은 점수여야 한다
//   copy  : 원본 SQL 그대로 + 원본 지표 → 0 근처의 낮은 점수여야 한다
//   broken: 실행 불가 SQL → -1이어야 한다
//
//   node training/scorer/evaluate.mjs [--json]
//
// 실제 실행 검증은 score.mjs --mode oracle (샌드박스 필요).

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreCandidate } from './scorer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../cases/data');
const asJson = process.argv.includes('--json');

const files = (await readdir(dataDir)).filter((f) => f.endsWith('.json')).sort();
const cases = [];
for (const f of files) {
  cases.push(JSON.parse(await readFile(path.join(dataDir, f), 'utf8')));
}

function dryExecution(caseData, metrics, status = 'ok') {
  return {
    status,
    resultEqual: true,
    bufferGets: metrics.buffer_gets,
    cost: metrics.cost,
    elapsedSec: metrics.elapsed_sec,
  };
}

const rows = [];
let orderingViolations = 0;

for (const caseData of cases) {
  const goldDiagnosis = {
    anti_patterns: caseData.diagnosis.anti_patterns,
    recommended_hints: caseData.diagnosis.recommended_hints,
    tuned_sql: caseData.gold_tuned_sql,
    risk_notes: caseData.diagnosis.risk_notes,
  };
  const gold = scoreCandidate({
    caseData,
    candidate: { diagnosis: goldDiagnosis },
    execution: dryExecution(caseData, caseData.gold_metrics),
  });

  const copyDiagnosis = { anti_patterns: [], recommended_hints: [], tuned_sql: caseData.original_sql };
  const copy = scoreCandidate({
    caseData,
    candidate: { diagnosis: copyDiagnosis },
    execution: dryExecution(caseData, caseData.original_metrics),
  });

  const broken = scoreCandidate({
    caseData,
    candidate: { diagnosis: { tuned_sql: 'DELETE FROM employees WHERE 1 = 1' } },
    execution: dryExecution(caseData, caseData.gold_metrics),
  });

  if (!(gold.reward > copy.reward && copy.reward > broken.reward)) orderingViolations += 1;
  rows.push({
    case_id: caseData.case_id, pattern: caseData.pattern,
    gold: gold.reward, copy: copy.reward, broken: broken.reward,
  });
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const medianOf = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const summary = {
  caseCount: rows.length,
  goldMean: Number(mean(rows.map((r) => r.gold)).toFixed(4)),
  goldMedian: medianOf(rows.map((r) => r.gold)),
  goldMin: Math.min(...rows.map((r) => r.gold)),
  copyMean: Number(mean(rows.map((r) => r.copy)).toFixed(4)),
  brokenAllMinusOne: rows.every((r) => r.broken === -1),
  orderingViolations,
};

if (asJson) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  console.log(`케이스 ${summary.caseCount}건 평가 완료`);
  console.log(`gold  평균 ${summary.goldMean} / 중앙값 ${summary.goldMedian} / 최소 ${summary.goldMin}`);
  console.log(`copy  평균 ${summary.copyMean}`);
  console.log(`broken 전부 -1: ${summary.brokenAllMinusOne}`);
  console.log(`순서 위반(gold > copy > broken): ${summary.orderingViolations}건`);
}
