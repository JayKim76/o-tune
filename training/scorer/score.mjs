// 케이스 1건 채점 CLI
//
// 사용법:
//   node training/scorer/score.mjs --case <case.json> --candidate <candidate.json> [--mode dry|oracle]
//
// candidate.json 형식:
//   {
//     "diagnosis": { "anti_patterns": [...], "recommended_hints": [...],
//                    "tuned_sql": "SELECT ...", "risk_notes": "..." },
//     // dry 모드 전용 (기록된/추정 지표로 채점):
//     "candidate_metrics": { "buffer_gets": 15100, "cost": 12, "elapsed_sec": 1.02 },
//     "result_equal": true,
//     "status": "ok"            // ok | error | timeout (기본 ok)
//   }
//
// oracle 모드는 샌드박스 환경변수(OTUNE_SANDBOX_*)로 실제 실행해 측정한다.

import { readFile } from 'node:fs/promises';
import { parseDiagnosis, scoreCandidate } from './scorer.mjs';

function argValue(args, name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const args = process.argv.slice(2);
const casePath = argValue(args, '--case');
const candidatePath = argValue(args, '--candidate');
const mode = argValue(args, '--mode') || 'dry';

if (!casePath || !candidatePath || !['dry', 'oracle'].includes(mode)) {
  console.error('사용법: node training/scorer/score.mjs --case <case.json> --candidate <candidate.json> [--mode dry|oracle]');
  process.exit(2);
}

let result;
let caseData;
try {
caseData = await readJson(casePath);
const candidate = await readJson(candidatePath);
const diagnosis = parseDiagnosis(candidate?.diagnosis ?? candidate);
const tunedSql = diagnosis.parsed?.tuned_sql || candidate?.tuned_sql || '';

if (mode === 'dry') {
  const metrics = candidate?.candidate_metrics || {};
  const execution = {
    status: candidate?.status || 'ok',
    resultEqual: candidate?.result_equal,
    rows: candidate?.result_rows,
    bufferGets: metrics.buffer_gets,
    cost: metrics.cost,
    elapsedSec: metrics.elapsed_sec,
  };
  result = scoreCandidate({ caseData, candidate, execution });
} else {
  const { getSandboxConfigFromEnv, runCaseInSandbox } = await import('./oracleRunner.mjs');
  const config = getSandboxConfigFromEnv();
  const run = await runCaseInSandbox(caseData, tunedSql, config);
  const effectiveCase = run.originalMeasure
    ? {
        ...caseData,
        original_metrics: {
          ...caseData.original_metrics,
          buffer_gets: run.originalMeasure.bufferGets,
          cost: run.originalMeasure.cost,
          elapsed_sec: run.originalMeasure.elapsedSec,
        },
      }
    : caseData;
  result = scoreCandidate({
    caseData: effectiveCase,
    candidate,
    execution: {
      status: run.status,
      resultEqual: run.resultEqual,
      bufferGets: run.bufferGets,
      cost: run.cost,
      elapsedSec: run.elapsedSec,
    },
  });
}

} catch (error) {
  console.error(`오류: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

console.log(JSON.stringify({ case_id: caseData.case_id, mode, ...result }, null, 2));
