// 튜닝 후보 자동 채점기 코어 (설계 문서 docs/rl-tuning-design.md 5장 구현)
// DB 접속과 분리된 순수 함수만 모아 단위 테스트가 가능하게 한다.

import { createHash } from 'node:crypto';

/** 문자열 리터럴과(힌트 제외) 주석을 제거해 키워드 검사용 텍스트를 만든다. */
export function stripForGuard(sql) {
  return String(sql || '')
    .replace(/\/\*\+[\s\S]*?\*\//g, ' ') // 힌트 블록 제거
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // 블록 주석 제거
    .replace(/--[^\n]*/g, ' ') // 라인 주석 제거
    .replace(/'(?:''|[^'])*'/g, "''"); // 문자열 리터럴 제거 ('' 이스케이프 포함)
}

const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
  'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'CALL', 'BEGIN', 'DECLARE', 'INTO',
  'DBMS_', 'UTL_',
];

/**
 * SELECT 문장 안에서도 부수효과를 만들 수 있는 패턴.
 * 문자열 검사는 원리적으로 완전하지 않으므로, 샌드박스 계정의 최소 권한
 * (SELECT 전용, EXECUTE 없음)과 격리된 DB가 1차 방어선이고 이 검사는 2차다.
 * - WITH FUNCTION / WITH PROCEDURE: 12c+ 인라인 PL/SQL 선언
 * - FOR UPDATE: SELECT 형태지만 행 락을 건다
 */
const FORBIDDEN_PATTERNS = [
  /\bWITH\s+(FUNCTION|PROCEDURE)\b/i,
  /\bFOR\s+UPDATE\b/i,
];

export function isSelectOnly(sql) {
  const text = stripForGuard(sql).trim();
  if (!text) return false;
  if (!/^(SELECT|WITH)\b/i.test(text)) return false;
  // 세미콜론 뒤에 내용이 있으면 다중 문장으로 간주
  const semi = text.indexOf(';');
  if (semi >= 0 && text.slice(semi + 1).trim().length > 0) return false;
  if (FORBIDDEN_PATTERNS.some((re) => re.test(text))) return false;
  const upper = ` ${text.toUpperCase().replace(/\s+/g, ' ')} `;
  return !FORBIDDEN_KEYWORDS.some((kw) => upper.includes(kw === 'DBMS_' || kw === 'UTL_' ? kw : ` ${kw} `) || upper.includes(` ${kw}(`));
}

/**
 * 보상 해킹용 금지 힌트. 하나라도 있으면 실행 전에 차단하고 BANNED_HINT로 채점한다.
 * - RESULT_CACHE: 반복 측정에서 캐시 히트로 Buffer Gets를 0처럼 보이게 한다
 * - PARALLEL / PARALLEL_INDEX: elapsed만 줄이고 전체 자원 사용량은 늘린다
 * - DYNAMIC_SAMPLING: 통계가 고정된 샌드박스에서 계획을 비결정적으로 바꾼다
 * OPT_ESTIMATE / CARDINALITY는 정당한 카디널리티 보정 수단이라 금지하지 않는다.
 * 대신 Cost를 보상에서 제거했으므로, 이 힌트들은 실측(Buffer Gets/elapsed)이
 * 실제로 좋아질 때만 점수를 받는다.
 */
export const BANNED_HINTS = ['RESULT_CACHE', 'PARALLEL', 'PARALLEL_INDEX', 'DYNAMIC_SAMPLING'];

/** 힌트 블록들의 원문을 배열로 돌려준다. */
export function extractHintBlocks(sql) {
  return [...String(sql || '').matchAll(/\/\*\+([\s\S]*?)\*\//g)].map((m) => m[1]);
}

/** 힌트 단위(괄호 깊이를 지키며 공백으로 분리한 지시어) 목록 */
export function extractHintUnits(sql) {
  const units = [];
  for (const block of extractHintBlocks(sql)) {
    let depth = 0;
    let current = '';
    for (const ch of block) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (/\s/.test(ch) && depth === 0) {
        if (current) units.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current) units.push(current);
  }
  return units;
}

export function analyzeHints(sql) {
  const units = extractHintUnits(sql);
  const names = units.map((u) => u.split('(')[0].toUpperCase());
  const joinMethods = new Set(names.filter((n) => ['USE_NL', 'USE_HASH', 'USE_MERGE'].includes(n)));
  const banned = names.filter((n) => BANNED_HINTS.includes(n));
  return {
    count: units.length,
    conflict: joinMethods.size >= 2,
    abuse: names.includes('MATERIALIZE'), // 동등성 우회 위험 힌트로 감점 대상 (설계 5.2)
    banned,
    hasBanned: banned.length > 0,
  };
}

/** 모델 출력(진단 JSON)을 파싱한다. 객체/문자열 모두 허용. */
export function parseDiagnosis(input) {
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch { return { valid: false, parsed: null }; }
  }
  if (!obj || typeof obj !== 'object') return { valid: false, parsed: null };
  if (typeof obj.tuned_sql !== 'string' || obj.tuned_sql.trim() === '') {
    return { valid: false, parsed: null };
  }
  return { valid: true, parsed: obj };
}

/**
 * 결과셋 동등성 해시. 행 순서를 무시하고(정렬 후 해시) 값만 비교한다.
 * rows: 배열의 배열 또는 배열의 객체.
 */
export function hashRows(rows) {
  const normalized = (Array.isArray(rows) ? rows : []).map((row) => {
    const values = Array.isArray(row) ? row : Object.keys(row).sort().map((k) => row[k]);
    return JSON.stringify(values.map((v) => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return v.toISOString();
      return String(v);
    }));
  });
  normalized.sort();
  return createHash('sha256').update(normalized.join('\n')).digest('hex');
}

export function clip(value, lo = -1, hi = 1) {
  return Math.min(hi, Math.max(lo, value));
}

function improvement(orig, cand) {
  const o = Number(orig) || 0;
  const c = Number(cand) || 0;
  if (o <= 0) return 0;
  return clip(1 - c / o);
}

/**
 * 보상 계산 (설계 문서 5.1, 2026-11-22 개편).
 * - Cost는 옵티마이저 추정값이라 힌트로 조작할 수 있어 보상에서 제외한다.
 *   impCost는 진단용으로만 계산하고 가중치는 0이다.
 * - 가중치: Buffer Gets 0.7 (가장 결정적), elapsed 0.3.
 * - 타임아웃은 -0.9: 결과 불일치(-1)에 가깝게 둬야 "안 끝나는 SQL"이
 *   성능 저하보다 유리해지는 역전 구간이 생기지 않는다.
 * input: {
 *   status: 'ok' | 'error' | 'timeout',
 *   resultEqual: boolean,
 *   diagnosisValid: boolean,
 *   hasRiskNotes: boolean,
 *   hints: { conflict, count, abuse, hasBanned },
 *   orig: { bufferGets, cost, elapsedSec },
 *   cand: { bufferGets, cost, elapsedSec },
 * }
 */
export function computeReward(input) {
  const breakdown = {
    base: 0, formatBonus: 0, riskBonus: 0,
    conflictPenalty: 0, hintCountPenalty: 0, abusePenalty: 0,
    impBg: 0, impCost: 0, impTime: 0,
  };

  if (input.status === 'error') return { reward: -1, verdict: 'EXECUTION_ERROR', breakdown };
  if (input.status === 'timeout') return { reward: -0.9, verdict: 'TIMEOUT', breakdown };
  if (!input.resultEqual) return { reward: -1, verdict: 'RESULT_MISMATCH', breakdown };
  if (!input.diagnosisValid) return { reward: -0.5, verdict: 'INVALID_FORMAT', breakdown };
  if (input.hints?.hasBanned) return { reward: -0.5, verdict: 'BANNED_HINT', breakdown };

  breakdown.impBg = improvement(input.orig?.bufferGets, input.cand?.bufferGets);
  breakdown.impCost = improvement(input.orig?.cost, input.cand?.cost);
  breakdown.impTime = improvement(input.orig?.elapsedSec, input.cand?.elapsedSec);
  breakdown.base = 0.7 * breakdown.impBg + 0.3 * breakdown.impTime;
  breakdown.formatBonus = 0.05;
  breakdown.riskBonus = input.hasRiskNotes ? 0.05 : 0;
  if (input.hints?.conflict) breakdown.conflictPenalty = -0.2;
  if ((input.hints?.count || 0) > 5) breakdown.hintCountPenalty = -0.02 * (input.hints.count - 5);
  if (input.hints?.abuse) breakdown.abusePenalty = -0.3;

  const total = breakdown.base + breakdown.formatBonus + breakdown.riskBonus
    + breakdown.conflictPenalty + breakdown.hintCountPenalty + breakdown.abusePenalty;
  return { reward: Number(clip(total).toFixed(4)), verdict: 'SCORED', breakdown };
}

/**
 * 케이스 + 후보 + 실행 결과를 받아 최종 채점한다.
 * execution: {
 *   status, rows?, resultEqual?, bufferGets, cost, elapsedSec
 * }
 * rows가 있으면 케이스의 orig_result_hash와 비교해 동등성을 판정한다.
 */
export function scoreCandidate({ caseData, candidate, execution }) {
  const diagnosis = parseDiagnosis(candidate?.diagnosis ?? candidate);
  const tunedSql = diagnosis.parsed?.tuned_sql || candidate?.tuned_sql || '';

  // 실행 전에 가드부터: SELECT 전용이 아니면 실행 오류와 동일하게 -1
  if (!isSelectOnly(tunedSql)) {
    return { reward: -1, verdict: 'BLOCKED_NOT_SELECT', breakdown: null, tunedSql };
  }

  // 금지 힌트도 실행 전에 차단한다. RESULT_CACHE를 실제로 실행하면
  // 샌드박스 캐시가 오염돼 같은 세션의 이후 측정까지 왜곡되기 때문이다.
  const hintInfo = analyzeHints(tunedSql);
  if (hintInfo.hasBanned) {
    return { reward: -0.5, verdict: 'BANNED_HINT', breakdown: null, tunedSql, bannedHints: hintInfo.banned };
  }

  let resultEqual = execution?.resultEqual;
  if (resultEqual === undefined && execution?.rows && caseData?.orig_result_hash) {
    resultEqual = hashRows(execution.rows) === caseData.orig_result_hash;
  }
  if (resultEqual === undefined) resultEqual = false;

  const result = computeReward({
    status: execution?.status || 'error',
    resultEqual,
    diagnosisValid: diagnosis.valid,
    hasRiskNotes: Boolean(diagnosis.parsed?.risk_notes),
    hints: hintInfo,
    orig: {
      bufferGets: caseData?.original_metrics?.buffer_gets,
      cost: caseData?.original_metrics?.cost,
      elapsedSec: caseData?.original_metrics?.elapsed_sec,
    },
    cand: {
      bufferGets: execution?.bufferGets,
      cost: execution?.cost,
      elapsedSec: execution?.elapsedSec,
    },
  });
  return { ...result, tunedSql };
}
