# 튜닝 특화 학습 (training/)

설계 문서 `docs/rl-tuning-design.md`의 구현 디렉터리다.
현재 상태: **로드맵 0단계 PoC — 채점기와 합성 케이스 100건 완료.**

## 구성

```
training/
  scorer/
    scorer.mjs       채점 코어 (보상 함수, SELECT 전용 가드, 힌트 분석, 결과 해시)
    oracleRunner.mjs 샌드박스 Oracle 실행·측정 (node-oracledb, DBMS_XPLAN 파싱)
    score.mjs        케이스 1건 채점 CLI (dry / oracle 모드)
    evaluate.mjs     케이스 전체 배치 평가 (드라이런)
  cases/
    templates.mjs    합성 케이스 템플릿 10종
    generate_cases.mjs 케이스 생성기
    data/            생성된 케이스 100건 (JSON)
    index.json       케이스 목록
  reports/
    poc-report.md    0단계 PoC 결과 보고서
```

## 실행

```bash
# 케이스 재생성 (결정적 생성이라 결과가 동일하다)
npm run cases:generate

# 배치 평가 (드라이런)
npm run train:evaluate

# 케이스 1건 채점 (드라이런: candidate JSON의 지표 사용)
node training/scorer/score.mjs --case training/cases/data/case-0001.json --candidate candidate.json --mode dry

# 케이스 1건 채점 (실행 모드: 샌드박스에서 실제로 실행해 측정)
OTUNE_SANDBOX_USER=otune_ro \
OTUNE_SANDBOX_PASSWORD=... \
OTUNE_SANDBOX_CONNECT_STRING=localhost:1521/FREEPDB1 \
node training/scorer/score.mjs --case training/cases/data/case-0001.json --candidate candidate.json --mode oracle
```

## 샌드박스 준비 (실행 모드용)

1. Oracle Database Free 컨테이너 등 운영과 분리된 DB를 준비한다.
2. 조회 전용 계정을 만든다 (채점기는 SELECT만 실행하지만 계정 권한으로도 차단).
3. 케이스의 `schema_ddl`로 스키마를 만들고 테스트 데이터를 적재한 뒤 통계를 고정한다.
   (데이터 적재 스크립트는 케이스 실측 단계에서 케이스별로 추가한다.)
4. 위 환경변수를 설정하고 `--mode oracle`로 채점한다.

## 현재 한계 (솔직한 상태)

- 이 저장소의 CI/개발 환경에는 Oracle이 없어, **실행 모드의 실DB 검증은 아직 수행되지 않았다.**
  드라이런 결과와 단위 테스트로 채점 로직까지만 검증된 상태다 (reports/poc-report.md 참고).
- 합성 케이스의 지표는 비용 모델 기반 추정치(`metrics_basis: "estimated"`)이며,
  케이스의 `review.verdict`는 샌드박스 실측을 통과한 뒤에만 `approved`로 올린다.
- 드라이런 보상은 개선 "비율"로 계산되므로 같은 패턴 안에서는 값이 동일하게 나온다.
  실제 분산은 실행 모드의 실측에서 생긴다.
