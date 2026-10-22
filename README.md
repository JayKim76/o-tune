# 오튠 (o-tune / ORCL-Tune)

LM Studio 로컬 AI와 규칙 기반 진단 엔진을 활용한 Oracle SQL 튜닝 웹 솔루션입니다.
React + TypeScript + Vite로 구성되어 있습니다.

## 실행

```bash
npm install
npm run dev   # http://localhost:5173/
```

Windows에서는 `run_orcl_tune_and_lmstudio.bat` 또는 `start_solution.ps1`로
LM Studio와 함께 원클릭 실행할 수 있습니다.

## 구성

- **Top SQL 대시보드** — 고부하 SQL 목록 (현재 목업 데이터, `src/data/mockOracleData.ts`)
- **SQL 진단** — 규칙 엔진(`src/utils/sqlParser.ts`: SQL 정규화·안티패턴 탐지·힌트 병합)과
  LM Studio 로컬 AI(`src/utils/lmStudioApi.ts`, OpenAI 호환 API `http://localhost:1234`) 진단
- **Plan Diff** — 선택한 SQL의 실행계획에서 Cost·Time을 직접 파싱해 튜닝 전/후 비교
- **학습 루프 / 튜닝 툴킷** — 튜닝 방법론 설명과 실무 진단 쿼리 모음

## 현재 상태 (중요)

- Oracle DB 실연동 백엔드는 아직 없습니다. DB 연결 설정은 화면 표기용이며, 연결 테스트는 수행되지 않습니다.
- LM Studio에 연결하지 못하면 폴백 **예시** 결과가 표시됩니다. 화면 상단 경고 배너로 구분되며,
  실제 AI 진단이 아니므로 튜닝 판단에 사용하면 안 됩니다.
- 규칙 엔진의 튜닝 후 수치는 실행계획 Time 기반 **추정**이며 실측이 아닙니다.
