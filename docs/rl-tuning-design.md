# 오튠 AI 모델 튜닝 특화 강화학습 설계 문서

- 작성일: 2026-10-22
- 대상: JayKim76/o-tune (LM Studio 로컬 AI 기반 Oracle SQL 튜닝 솔루션)
- 상태: 설계안 v1 (구현 전)
- 요약: 순수 강화학습부터 시작하지 않는다. **SFT → DPO → GRPO(검증 가능 보상)** 순서로 진행하고, 프로젝트의 핵심 자산은 알고리즘이 아니라 **샌드박스 Oracle 자동 채점기와 검수된 튜닝 케이스 데이터셋**이다.

---

## 1. 목적과 범위

### 1.1 목적
LM Studio에서 운용 중인 로컬 AI 모델을 Oracle SQL 튜닝 진단에 특화시킨다. 모델의 출력 대상은 o-tune의 진단 결과(안티패턴 진단, 권장 힌트, 튜닝 SQL, 위험 고지)이며, 최종 판단과 적용은 항상 DBA가 한다.

### 1.2 비목표 (하지 않는 것)
- 모델 출력 SQL을 운영 DB에 자동 실행하는 기능
- DML/DDL 자동 적용 (인덱스 생성 제안은 "제안"까지만, 실행은 사람)
- 범용 대화 성능 향상 (튜닝 도메인 외 성능은 평가 대상이 아님)

### 1.3 성공의 정의
8장의 평가 게이트를 통과하는 모델 버전이 배포된다. 핵심은 "그럴듯한 설명"이 아니라 **실행 가능하고, 결과가 동일하며, 실측 지표가 개선되는 튜닝 SQL**을 내는 비율이다.

## 2. 전체 아키텍처

```
[케이스 수집]                [학습 파이프라인]              [배포]
사내 튜닝 사례 ──┐
V$SQL 이력 ──────┼─> 케이스 데이터셋 ─> SFT ─> DPO ─> GRPO ─> 평가 게이트 ─> 모델 레지스트리 ─> LM Studio
합성 케이스 ─────┘        ▲                              │            (통과 시만 승격)        (GGUF 교체)
                          │                              ▼
o-tune DBA 피드백 ────────┘                    샌드박스 Oracle 채점기
(적용/기각/수정본)                        (실행 검증 + 결과 동등성 + 지표 비교)
```

구성 요소:
- **케이스 데이터셋**: 3장의 스키마로 저장되는 검수 완료 튜닝 사례 집합. 버전 관리 대상.
- **샌드박스 채점기**: 4장의 절차로 후보 SQL을 실행 검증하고 5장의 보상을 계산하는 프로그램. SFT 평가, DPO 쌍 생성, GRPO 보상에 공통으로 사용한다.
- **학습 파이프라인**: 6장의 3단계 학습. 단계마다 평가 게이트를 통과해야 다음 단계로 간다.
- **모델 레지스트리**: 7.3장의 버전·평가 기록 보관소. LM Studio 배포와 롤백의 기준점.
- **피드백 환류**: o-tune 사용 중 쌓이는 DBA 피드백이 케이스 후보가 되어 데이터셋으로 돌아온다.

## 3. 데이터 설계

### 3.1 케이스 스키마

케이스 1건은 아래 JSON으로 저장한다 (파일: `data/cases/<case_id>.json`, 집합은 `dataset_version`으로 태깅).

```json
{
  "case_id": "case-0001",
  "source": "internal | vsql_history | synthetic",
  "schema_ddl": "CREATE TABLE emp (...); CREATE INDEX ...;",
  "stats_snapshot_id": "snap-2026-10-22-a",
  "original_sql": "SELECT ... FROM emp e, dept d WHERE ...",
  "original_plan": "DBMS_XPLAN 출력 전문",
  "original_metrics": { "elapsed_sec": 28.45, "buffer_gets": 845200, "disk_reads": 32400, "executions": 1420 },
  "gold_tuned_sql": "SELECT /*+ ... */ ...",
  "gold_metrics": { "elapsed_sec": 1.02, "buffer_gets": 15100, "disk_reads": 210 },
  "diagnosis": {
    "anti_patterns": ["FULL_TABLE_SCAN", "PARSING_OVERHEAD"],
    "recommended_hints": ["/*+ INDEX(e idx_emp_job_sal) */"],
    "risk_notes": "인덱스 생성 시 쓰기 부하 증가 가능"
  },
  "review": { "reviewer": "dba-name", "verdict": "approved", "reviewed_at": "2026-10-22" }
}
```

원칙:
- `gold_tuned_sql`은 샌드박스에서 실행 검증(결과 동등 + 지표 개선)을 통과한 것만 `approved`로 인정한다.
- 운영 데이터의 행 값은 저장하지 않는다. 스키마, 통계, 실행계획, 지표까지만 저장한다.

### 3.2 데이터 소스

| 소스 | 수집 방법 | 특성 |
|---|---|---|
| 사내 튜닝 사례 | 과거 튜닝 보고서·작업 이력을 스키마로 변환 | 품질 최고, 양 적음. 홀드아웃 우선 배정 |
| V$SQL 이력 | 백엔드 에이전트의 조회 쿼리 확장, 고부하 SQL + 실행계획 수집 | 양 확보 용이, 정답은 샌드박스 검증으로 별도 생성 |
| 합성 케이스 | 스키마 템플릿(조인 패턴, 스캔 패턴, 스큐 데이터) 변형 생성 | 패턴 커버리지 확보, 정답 자동 생성 가능 |

### 3.3 정제와 마스킹
- 리터럴은 학습 입력에서 원본을 유지하되, 고객 식별이 가능한 문자열 리터럴은 동일 패턴의 가상 값으로 치환한다.
- 스키마명·테이블명은 기본 유지(튜닝 판단에 필요), 고객사명은 코드명으로 익명화한다.
- 외부 GPU 클라우드에서 학습할 경우 마스킹 완료본만 반출한다.

### 3.4 데이터셋 분리
- train / validation / holdout = 8 / 1 / 1.
- **스키마 단위 분리**: 같은 스키마의 변형 케이스가 train과 holdout에 동시에 들어가지 않게 한다 (누수로 인한 과대평가 방지).
- holdout은 학습 파이프라인이 절대 학습에 사용하지 않으며, 평가 게이트 전용이다.

## 4. 샌드박스 실행·채점 환경

### 4.1 구성
- Oracle Database Free(컨테이너)를 샌드박스 전용으로 운용한다. 운영 DB와 네트워크·계정을 분리한다.
- 케이스 실행 전 `schema_ddl`과 통계 스냅샷을 복원한다. 통계는 `DBMS_STATS` 내보내기/가져오기 또는 스냅샷 이미지 복원으로 고정해, 채점 간 재현성을 확보한다.
- 기준값 측정: 원본 SQL을 3회 실행해 elapsed 중앙값을 취하고, buffer gets는 `DBMS_XPLAN.DISPLAY_CURSOR(..., 'ALLSTATS LAST')`의 Buffers 합산으로 측정한다 (시간보다 결정적이라 보상 1순위 지표).

### 4.2 안전 장치
- 전용 계정은 SELECT 권한만 가진다. 후보 SQL은 실행 전 파서로 검사해 SELECT 외 문장, DDL/DML 키워드, 위험 힌트(`PARALLEL` 과다 지정 등)를 차단한다. o-tune의 `src/utils/sqlParser.ts` 규칙을 재사용할 수 있다.
- 쿼리 타임아웃(예: 30초)과 동시 실행 수 제한을 둔다. 타임아웃은 실행 실패가 아니라 "개선 없음"으로 채점한다 (4.3 참고).
- 샌드박스는 인터넷과 운영망에 연결하지 않는다.

### 4.3 채점 절차
1. 원본 SQL 실행 → 결과셋 해시(정렬 후 해시, ORDER BY가 없는 쿼리 대응), elapsed 중앙값, buffer gets 기록.
2. 후보 SQL 실행 → 동일 절차로 측정.
3. 실행 오류면 즉시 실패 처리. 결과 해시가 다르면 결과 불일치로 실패 처리.
4. 통과한 경우에만 5장의 보상으로 개선 성분을 계산한다.

## 5. 보상 함수

### 5.1 정의

```
실행 실패 (문법 오류, 권한, 파서 차단)        R = -1.0
결과 불일치 (해시 상이)                        R = -1.0
출력 형식 위반 (진단 JSON 파싱 실패)           R = -0.5
타임아웃                                      R = -0.2  (실패가 아닌 개선 없음으로 취급)

개선 성분 (모두 clip(-1, 1)):
  imp_bg   = 1 - tuned_buffer_gets / max(orig_buffer_gets, 1)
  imp_cost = 1 - tuned_cost / max(orig_cost, 1)
  imp_time = 1 - tuned_elapsed / max(orig_elapsed, 1)

R = 0.5 * imp_bg + 0.3 * imp_cost + 0.2 * imp_time + 보너스 - 감점
  보너스: 형식 준수 +0.05, 위험 고지(risk_notes) 포함 +0.05
  감점: 상충 힌트 쌍(USE_HASH vs USE_NL 등) -0.2, 힌트 5개 초과 시 개당 -0.02,
        우회성 힌트 남용(MATERIALIZE로 동등성만 맞추기 등) -0.3
```

가중치 근거: buffer gets는 측정 변동이 가장 작아 0.5, cost는 옵티마이저 추정치라 0.3, elapsed는 캐시·부하 영향이 커서 0.2로 낮게 둔다.

### 5.2 보상 해킹 방지
- 결과 동등성을 통과하지 못하면 개선 성분을 일절 인정하지 않는다 (빠르지만 틀린 SQL 차단).
- 통계를 케이스마다 고정하므로, 통계 조작성 힌트만으로 cost를 낮추는 우회를 막는다. cost 개선만 있고 buffer gets 개선이 없으면 총점이 낮게 설계되어 있다.
- 인덱스 생성 같은 DDL 제안은 실행 검증이 불가능하므로 보상 대상에서 제외한다. SFT/DPO 단계에서 DBA 평가로만 다룬다.
- 동일 케이스에 대한 후보 채점은 샌드박스 상태를 초기화한 뒤 수행해 캐시 선행 효과를 줄인다.

## 6. 학습 파이프라인

### 6.1 베이스 모델 선정 기준
- SQL·코드 생성에 강한 Instruct 모델 (예: Qwen Coder 계열 7B~14B).
- 현재 LM Studio 운용 모델과 동일 계열을 우선한다 (배포 시 GGUF 변환 경로가 검증되어 있기 때문).
- 한국어 설명 품질이 필요하므로 다국어 성능을 사전 평가 케이스 10건으로 확인한 뒤 확정한다.

### 6.2 1단계: SFT (지도학습)
- 목적: 출력 형식 고정 + 도메인 지식 주입. RL의 전제 조건이다.
- 데이터 포맷: 부록 A. 입력은 스키마 요약 + 원본 SQL + 실행계획 + 지표, 출력은 진단 JSON.
- 방법: LoRA (rank 16~32, lr 1e-4~2e-4, 2~3 epoch). 도구: TRL SFTTrainer + Unsloth.
- 통과 기준: validation에서 형식 준수율 99% 이상, 실행 가능률(샌드박스) 베이스 모델 대비 유의미한 향상.

### 6.3 2단계: DPO (선호 최적화)
- 목적: DBA의 판단 취향(보수적 힌트 선호, 위험 회피 등 수치화하기 어려운 기준) 학습.
- 쌍 생성: 케이스마다 SFT 모델 후보 4개를 생성 → 샌드박스 점수 상위/하위 + DBA 선택을 결합해 chosen/rejected 쌍 구성. 점수 차가 큰 쌍을 우선 사용한다.
- 방법: TRL DPOTrainer, beta 0.1, lr 5e-5 수준 (초기값, 평가 보며 조정).
- 데이터 원천: 7.1의 o-tune 피드백 (적용=chosen, 기각=rejected, 수정본=chosen으로 우선 사용).

### 6.4 3단계: GRPO (검증 가능 보상 기반 RL)
- 목적: 샌드박스 실측 보상으로 튜닝 성능 자체를 끌어올린다.
- 방법: 케이스당 후보 그룹 4~8개 생성 → 5장 보상으로 채점 → 그룹 내 상대 우위로 정책 업데이트 (TRL GRPOTrainer, 생성 가속은 vLLM). 가치망이 없어 PPO보다 운용이 가볍다.
- 초기 하이퍼파라미터: LoRA, lr 1e-5~2e-5, KL 페널티로 SFT 모델에서 과도하게 벗어나지 않게 제한.
- 체크포인트마다 8장 게이트로 평가하고, 통과한 체크포인트만 승격 후보가 된다.

### 6.5 하드웨어 가이드 (추정치)
| 작업 | 최소 | 권장 |
|---|---|---|
| 7B QLoRA SFT/DPO | VRAM 16GB | 24GB |
| 7B GRPO (생성+학습) | VRAM 24GB | 48GB 또는 클라우드 단기 대여 |
| 14B 학습 전반 | VRAM 48GB | 클라우드 |

학습은 별도 GPU 장비에서 수행하고, LM Studio 로컬 PC는 추론 전용으로 유지한다.

## 7. o-tune 연동 설계

### 7.1 피드백 수집
진단 결과에 대한 DBA 액션을 케이스 후보로 적재한다. 백엔드 에이전트(`server/index.mjs`)에 로컬 전용 라우트를 추가하는 안:

```
POST /oracle-api/feedback
{ "sql_id": "...", "diagnosis_json": {...}, "action": "applied | rejected | edited",
  "edited_sql": "...", "note": "..." }
→ data/feedback/<date>.jsonl 에 append (Git 미포함, 로컬 자산)
```

적재된 피드백은 검수(3.1의 review)를 거쳐 케이스로 승격된다. 무검수 데이터는 학습에 쓰지 않는다.

### 7.2 학습 트리거
자동 학습은 하지 않는다. 검수 완료 신규 케이스가 일정 수(예: 50건) 누적되면 운영자가 파이프라인을 실행하고, 결과는 평가 게이트를 통과했을 때만 배포된다.

### 7.3 모델 레지스트리와 배포
```
models/
  otune-sql-v1/  (SFT)
  otune-sql-v2/  (DPO)
  otune-sql-v3/  (GRPO)
  각 디렉터리에 model-card.md: 베이스 모델, 데이터셋 버전, 학습 단계,
  홀드아웃 평가 점수, 배포일, 롤백 대상 버전
```
- 배포: GGUF 변환(llama.cpp) → 양자화 Q4_K_M 권장 → LM Studio 모델 폴더에 등록 → o-tune에서 활성 모델 교체.
- 롤백: model-card의 이전 버전을 LM Studio에서 다시 선택하면 끝나는 구조를 유지한다 (코드 변경 없는 롤백).

## 8. 평가 체계

### 8.1 지표 (홀드아웃 기준)
| 지표 | 정의 |
|---|---|
| 실행 가능률 | 후보 SQL이 샌드박스에서 오류 없이 실행된 비율 |
| 결과 동등률 | 결과 해시가 원본과 일치한 비율 |
| 형식 준수율 | 진단 JSON 파싱 성공 비율 |
| BG 개선율 | buffer gets 개선율의 중앙값 |
| Cost 개선율 | 실행계획 cost 개선율의 중앙값 |
| DBA 채택률 | 피드백에서 applied 비율 (운용 지표) |
| 회귀율 | gold 대비 지표가 악화된 케이스 비율 |

### 8.2 배포 게이트 (초기 권장값, 운용하며 조정)
- 결과 동등률 100% 미만이면 배포 금지 (단 1건의 불일치도 원인 분석 후 재평가).
- 실행 가능률 98% 이상, 형식 준수율 99% 이상.
- BG 개선율 중앙값이 현재 배포 모델보다 높을 것 (동률이면 승격하지 않음).
- 회귀율 5% 이하.

### 8.3 비교 리포트
학습 실행마다 구 모델 vs 신 모델의 홀드아웃 지표 비교표를 자동 생성해 model-card에 첨부한다. 숫자 없는 "좋아진 것 같다"는 승격 사유가 되지 않는다.

## 9. 보안·라이선스·운영 원칙

- 학습과 채점은 사내망 안에서 수행한다. 외부 클라우드를 쓸 경우 3.3 마스킹 완료본만 반출한다.
- AWR/ASH 데이터를 학습 소스로 쓸 경우 Oracle Diagnostics Pack 라이선스 대상인지 먼저 확인한다. `V$SQL` 기반 수집은 해당하지 않는다.
- 어떤 단계에서도 모델 출력을 운영 DB에 자동 실행하지 않는다. 힌트·인덱스 적용은 DBA 승인 절차를 거친다.
- 학습 데이터에 운영 데이터의 행 값을 포함하지 않는다 (3.1 원칙 재확인).

## 10. 단계별 로드맵 (1인 개발 기준, 기간은 추정치)

| 단계 | 내용 | 산출물 | 완료 기준 |
|---|---|---|---|
| 0 | 채점기 + 케이스 PoC | 샌드박스 채점 스크립트, 케이스 100건 | 임의 후보 10건을 자동 채점해 DBA 수동 채점과 일치 |
| 1 | SFT v1 | LoRA 어댑터, 평가 리포트 | 6.2 통과 기준 충족 |
| 2 | 피드백 연동 + DPO v1 | `/oracle-api/feedback`, DPO 모델 | 홀드아웃에서 SFT 대비 BG 개선율 향상 |
| 3 | GRPO v1 | GRPO 모델, 게이트 리포트 | 8.2 게이트 통과 |
| 4 | 정식 운용 루프 | 모델 레지스트리 운용, 주기적 재학습 | 피드백 누적 → 재학습 → 승격 사이클 1회 완주 |

## 11. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 보상 해킹 (빠르지만 틀린 SQL, 우회 힌트) | 결과 동등성 필수화, 5.2 감점·통계 고정 |
| 샌드박스와 운영의 통계·데이터량 차이로 실전 개선 실패 | 케이스 스키마에 운영 통계 스냅샷 사용, 배포 후 DBA 채택률로 사후 검증 |
| 결과 동등성 판정 오류 (정렬 없는 쿼리) | 정렬 후 해시, 동등성 판정 자체를 테스트 케이스로 검증 |
| 소규모 데이터 과적합 | 스키마 단위 분리, 홀드아웃 게이트, KL 제한 |
| GPU 비용·시간 초과 | 7B부터 시작, 단계별 게이트로 조기 중단 판단, 클라우드 단기 대여 |
| 특정 Oracle 버전 문법 차이 | 케이스에 DB 버전 기록, 샌드박스 버전을 운영과 맞춤 |

## 부록 A. 입출력 포맷 예시

입력 (user):
```
[스키마] emp(empno, ename, job, sal, deptno), dept(deptno, dname) / 인덱스: PK_EMP
[SQL] SELECT e.empno, e.ename, d.dname, e.sal FROM emp e, dept d WHERE e.deptno = d.deptno AND e.job = 'MANAGER' AND e.sal > 3000
[실행계획] ... TABLE ACCESS FULL EMP ...
[지표] elapsed 28.45s, buffer_gets 845200, executions 1420
```

출력 (assistant, JSON):
```json
{
  "anti_patterns": ["FULL_TABLE_SCAN", "PARSING_OVERHEAD"],
  "recommended_hints": ["/*+ INDEX(e idx_emp_job_sal) */"],
  "tuned_sql": "SELECT /*+ INDEX(e idx_emp_job_sal) */ ... WHERE e.job = :b1 AND e.sal > :b2",
  "risk_notes": "결합 인덱스 신규 생성 시 쓰기 부하 증가 가능. 기존 인덱스와 중복 여부 확인 필요."
}
```

## 부록 B. 채점 의사코드

```
function score(case, candidate_sql):
    if not is_select_only(candidate_sql): return -1.0        # 파서 차단
    cand = sandbox_run(case, candidate_sql, timeout=30s)
    if cand.error: return -1.0
    if cand.timed_out: return -0.2
    if hash_sorted(cand.rows) != case.orig_result_hash: return -1.0
    parsed = parse_diagnosis_json(candidate_output)
    if parsed.invalid: return -0.5
    r = 0.5*clip(1 - cand.buffer_gets/case.orig_buffer_gets)
      + 0.3*clip(1 - cand.cost/case.orig_cost)
      + 0.2*clip(1 - cand.elapsed/case.orig_elapsed)
    r += bonuses(parsed) - penalties(parsed)                  # 5.1 보너스·감점
    return r
```
