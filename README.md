# 오튠 (o-tune / ORCL-Tune)

LM Studio 로컬 AI와 규칙 기반 진단 엔진을 활용한 Oracle SQL 튜닝 웹 솔루션입니다.
React + TypeScript + Vite 프론트엔드와 Node.js 로컬 백엔드 에이전트로 구성되어 있습니다.

## 실행

```bash
npm install

# 터미널 1: Oracle 로컬 백엔드 에이전트 (127.0.0.1:8787)
npm run server

# 터미널 2: 웹 개발 서버 (http://localhost:5173/)
npm run dev
```

Windows에서는 `run_orcl_tune_and_lmstudio.bat` 또는 `start_solution.ps1`이
LM Studio, 백엔드 에이전트, 웹 서버를 함께 실행합니다.

프로덕션 빌드는 에이전트가 함께 제공합니다.

```bash
npm run build
npm run server   # http://127.0.0.1:8787/ 에서 화면과 API 제공
```

## Oracle 실데이터 연동

브라우저는 Oracle에 직접 접속할 수 없으므로, 같은 PC에서 실행되는 백엔드
에이전트(`server/index.mjs`)가 `node-oracledb` Thin 모드로 대신 접속합니다.

1. 에이전트 실행 후 화면 우측 상단의 Oracle DB 연결 설정을 엽니다.
2. 호스트, 포트, 서비스명, 계정, 비밀번호를 입력하고 **DB 연결 테스트**를 누릅니다.
   실제 접속이 성공하면 응답 시간, DB 이름, Oracle 버전이 표시됩니다.
3. **연결 확인 후 저장하고 실데이터 조회**를 누르면 대시보드가 샘플 데이터에서
   `V$SQLSTATS` 실데이터로 전환됩니다.

백엔드가 실행하는 쿼리는 코드에 고정되어 있습니다 (임의 SQL 실행 API 없음).

- 연결 테스트: `SYS_CONTEXT`로 DB/서비스/사용자 확인, `V$INSTANCE` 버전 조회
- Top SQL: `V$SQLSTATS`에서 elapsed_time 상위 최대 20개, DB Time 비중은 전체 합계 대비로 계산
- 실행계획: SQL별 `DBMS_XPLAN.DISPLAY_CURSOR(sql_id, 0, 'TYPICAL +PREDICATE')`
- 지표: `V$SESSION` 활성 세션 수, `V$SYSSTAT` 캐시 통계로 계산한 버퍼 캐시 히트율
  (인스턴스 시작 이후 누적 기준)

### 보안 원칙

- 에이전트는 `127.0.0.1`에만 바인딩하고 허용된 로컬 Origin만 받습니다.
- DB 비밀번호는 저장하거나 로그로 남기지 않습니다. 화면 메모리에만 유지되며,
  새로고침하면 다시 입력해야 합니다.
- 필요하면 에이전트 실행 시 `OTUNE_API_TOKEN` 환경변수를 설정하고,
  연결 모달의 토큰 칸에 같은 값을 입력할 수 있습니다. (`.env.example` 참고)
- 조회 계정은 `V$SQLSTATS`, `V$SESSION`, `V$SYSSTAT`, `DBMS_XPLAN` 조회 권한이 필요합니다.
  운영 DB에서는 SYSTEM 대신 전용 모니터링 계정 사용을 권장합니다.

## 구성

- **Top SQL 대시보드** — 실데이터 연결 시 `V$SQLSTATS` 기반 목록과 실측 KPI,
  미연결 시 샘플 데이터임을 명시하고 표시
- **SQL 진단** — 규칙 엔진(`src/utils/sqlParser.ts`: SQL 정규화·안티패턴 탐지·힌트 병합)과
  LM Studio 로컬 AI(`src/utils/lmStudioApi.ts`, OpenAI 호환 API `http://localhost:1234`) 진단
- **Plan Diff** — 선택한 SQL의 실행계획에서 Cost·Time을 직접 파싱해 비교.
  튜닝 후 실행계획은 실제 실행 전에는 표시하지 않음
- **학습 루프 / 튜닝 툴킷** — 튜닝 방법론 설명과 실무 진단 쿼리 모음

## 테스트

```bash
npm test        # 백엔드 데이터 변환·검증 단위 테스트
npm run build   # 타입체크 + 빌드
npm run lint    # oxlint
```

## 현재 상태 (중요)

- LM Studio에 연결하지 못하면 폴백 **예시** 결과가 표시됩니다. 화면 상단 경고 배너로 구분되며,
  실제 AI 진단이 아니므로 튜닝 판단에 사용하면 안 됩니다.
- 규칙 엔진의 튜닝 후 수치는 실행계획 Time 기반 **추정**이며 실측이 아닙니다.
- `V$SQLSTATS`의 SQL_TEXT는 앞부분 1,000자까지만 제공되므로, 긴 SQL의 정밀 진단은
  진단 화면에 전체 SQL을 직접 붙여 넣어 주세요.
