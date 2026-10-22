// 합성 케이스 100건을 training/cases/data/에 생성한다.
//   node training/cases/generate_cases.mjs
// 결정적 생성이므로 재실행해도 같은 내용이 된다.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCases } from './templates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');

const cases = buildCases();
await rm(dataDir, { recursive: true, force: true });
await mkdir(dataDir, { recursive: true });

for (const c of cases) {
  await writeFile(path.join(dataDir, `${c.case_id}.json`), `${JSON.stringify(c, null, 2)}\n`, 'utf8');
}

const index = cases.map((c) => ({
  case_id: c.case_id, pattern: c.pattern, family: c.family,
  metrics_basis: c.metrics_basis, verdict: c.review.verdict,
}));
await writeFile(path.join(__dirname, 'index.json'), `${JSON.stringify({ count: cases.length, cases: index }, null, 2)}\n`, 'utf8');

console.log(`케이스 ${cases.length}건 생성 완료: ${dataDir}`);
