# o-tune 새 Windows PC 설치 메뉴얼

o-tune(오튠)을 처음 사용하는 Windows PC에 설치하고, Oracle 실데이터 연동과
LM Studio 로컬 AI 진단까지 동작시키는 절차입니다.

## 0. 구성 요소

| 구성 요소 | 역할 | 필수 여부 |
| --- | --- | --- |
| Node.js 앱 (이 저장소) | 웹 화면 + 로컬 백엔드 에이전트(127.0.0.1:8787) | 필수 |
| Oracle Database | 튜닝 대상 DB. 같은 PC든 다른 서버든 접속만 되면 됨 | 필수 (실데이터 연동 시) |
| LM Studio | 로컬 AI 튜닝 진단용 LLM 서버 (localhost:1234) | 선택 (AI 진단 쓸 때만) |

브라우저는 Oracle과 LM Studio에 직접 접속하지 않습니다. 같은 PC에서 도는
백엔드 에이전트가 대신 접속하므로, Oracle Instant Client 같은 별도 드라이버
설치가 필요 없습니다 (node-oracledb Thin 모드).

## 1. 사전 준비

### 1-1. Node.js 설치

1. https://nodejs.org 에서 **LTS 버전(20.19 이상 또는 22.12 이상)** 을 내려받아 설치합니다.
   Vite 8이 이 버전부터 동작합니다.
2. PowerShell을 새로 열고 버전을 확인합니다.

```powershell
node -v
npm -v
```

두 명령 모두 버전이 출력되어야 합니다. 출력되지 않으면 설치 후 터미널을
다시 열었는지 확인하세요.

### 1-2. Git 설치 (선택)

- Git이 있으면 클론으로 받고, 없으면 2장의 ZIP 방법으로 받으면 됩니다.
- Git 설치: https://git-scm.com/download/win

### 1-3. Oracle 접속 정보 확인

아래 5가지를 미리 준비합니다.

- 호스트 (IP 또는 호스트명)
- 포트 (기본 1521)
- **서비스명** (SID가 아닙니다. DB에서 `SELECT value FROM v$parameter WHERE name = 'service_names'` 로 확인)
- 계정 / 비밀번호 (6장의 권한 참고)
- DB가 다른 PC나 서버에 있으면 그 사이의 방화벽에서 1521 포트가 열려 있어야 합니다.

### 1-4. LM Studio 설치 (AI 진단을 쓸 때만)

- https://lmstudio.ai 에서 설치합니다. 모델 파일이 수 GB 단위이므로 디스크
  여유와 메모리를 확보하세요. 설치만으로는 부족하고 7장의 서버 실행이 필요합니다.

## 2. 코드 받기

Git 사용 시:

```powershell
cd $HOME
git clone https://github.com/JayKim76/o-tune.git
cd o-tune
```

ZIP 사용 시: GitHub 저장소 페이지에서 **Code → Download ZIP** 으로 받아
압축을 풀고, PowerShell에서 그 폴더로 이동합니다.

```powershell
cd $HOME\Downloads\o-tune-main
```

## 3. 의존성 설치

프로젝트 폴더에서 한 번만 실행합니다.

```powershell
npm install
```

에러 없이 끝나면 준비 완료입니다. (`node_modules` 폴더가 생깁니다.)

## 4. 실행

### 방법 A. 운영 방식 (권장, 평소 사용)

```powershell
npm run build
npm run server
```

브라우저에서 **http://127.0.0.1:8787/** 로 접속합니다. 에이전트 하나가
화면과 API를 모두 제공합니다. 종료는 터미널에서 `Ctrl + C` 입니다.

### 방법 B. 개발 방식 (코드 수정 시)

터미널 2개를 사용합니다.

```powershell
# 터미널 1
npm run server

# 터미널 2
npm run dev
```

브라우저에서 **http://localhost:5173/** 로 접속합니다.

### 방법 C. 원클릭 스크립트

프로젝트 폴더의 `run_orcl_tune_and_lmstudio.bat` 을 더블클릭하면 LM Studio,
에이전트, 개발 서버를 함께 실행하고 브라우저까지 열어 줍니다 (방법 B 구성).

PowerShell 스크립트(`start_solution.ps1`)가 실행 정책 오류로 막히면 한 번만
아래 명령으로 허용합니다.

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 5. 환경변수 (선택 설정)

주의: 에이전트는 `.env` 파일을 자동으로 읽지 않습니다. 환경변수는
`npm run server` 를 실행하는 PowerShell 창에서 먼저 설정해야 합니다.

```powershell
# 에이전트 포트 변경 (기본 8787)
$env:OTUNE_API_PORT = "8787"

# 에이전트 토큰: 설정하면 DB 연결 모달의 토큰 칸에 같은 값을 넣어야 합니다
$env:OTUNE_API_TOKEN = "원하는-토큰-문자열"

# LM Studio 주소 변경 (기본 http://127.0.0.1:1234, localhost만 허용)
$env:OTUNE_LM_URL = "http://127.0.0.1:1234"

npm run server
```

## 6. Oracle 연결 설정

1. 화면 우측 상단의 **DB 연결 설정** 을 엽니다. 모달 상단에 에이전트 상태가
   표시됩니다. 에이전트가 꺼져 있으면 먼저 4장의 실행부터 하세요.
2. 값을 입력합니다.

| 항목 | 설명 |
| --- | --- |
| DB Host | Oracle 서버 IP 또는 호스트명 |
| Listener Port | 기본 1521 |
| Service Name | SID가 아닌 서비스명 (1-3 참고) |
| DB User | 계정명. SYSDBA 권한 접속은 지원하지 않습니다 |
| 비밀번호 | 저장되지 않습니다. 화면 메모리에만 유지되고 새로고침하면 다시 입력합니다 |
| DRCP | DB 서버에 DRCP가 설정된 경우에만 켭니다. 기본은 끔입니다 |

3. **DB 연결 테스트** 를 눌러 성공 메시지(응답 시간, DB 이름, Oracle 버전)를
   확인합니다.
4. **연결 확인 후 저장하고 실데이터 조회** 를 누르면 대시보드가 샘플 데이터에서
   실데이터로 전환됩니다.

### 조회 계정 권한

대시보드는 `V$SQLSTATS`, `V$SESSION`, `V$SYSSTAT`, `V$INSTANCE` 조회와
`DBMS_XPLAN.DISPLAY_CURSOR` 실행이 필요합니다. 운영 DB에서는 SYSTEM 대신
전용 모니터링 계정을 권장합니다 (SYS 권한 계정에서 실행).

```sql
CREATE USER otune_mon IDENTIFIED BY "비밀번호";
GRANT CREATE SESSION, SELECT_CATALOG_ROLE TO otune_mon;
```

## 7. LM Studio 연결 (AI 진단을 쓸 때)

1. LM Studio를 실행하고 사용할 모델을 다운로드해 **로드**합니다.
2. LM Studio의 **Developer 탭에서 Local Server를 시작**합니다 (포트 1234).
   CORS 설정은 따로 할 필요가 없습니다. 에이전트가 대신 호출합니다.
3. o-tune 화면의 **LM Studio 설정** 에서 연결 테스트를 눌러 ONLINE과 모델
   목록이 보이는지 확인하고 저장합니다.
4. SQL 진단 화면에서 **LM Studio 로컬 AI 튜닝 실행** 버튼을 누릅니다.
   실패하면 예시 결과가 아니라 실패 이유가 표시되고 Rule Engine 진단으로
   자동 전환됩니다.

## 8. 정상 동작 체크리스트

- [ ] http://127.0.0.1:8787/oracle-api/health 접속 시 `ok: true` 가 보인다
- [ ] DB 연결 테스트 성공 후 대시보드에 실데이터가 표시된다
- [ ] **AI Rule Engine 진단** 버튼 결과가 즉시 나온다
- [ ] (LM 사용 시) **LM Studio 로컬 AI 튜닝 실행** 결과가 나오거나,
      실패 시 원인이 문장으로 표시된다

## 9. 문제 해결

| 증상 | 원인과 조치 |
| --- | --- |
| `npm` 명령을 찾을 수 없음 | Node.js 설치 후 터미널을 새로 열었는지 확인. 그래도 안 되면 Node.js 재설치 |
| `EADDRINUSE ... 8787` | 다른 프로세스가 포트를 사용 중. `netstat -ano \| findstr :8787` 로 PID 확인 후 `taskkill /PID <번호> /F`, 또는 `OTUNE_API_PORT` 로 포트 변경 |
| 모달에 "에이전트에 닿지 않습니다" | `npm run server` 가 실행 중인지 확인. 방화벽 팝업이 뜨면 개인 네트워크에서 허용 |
| ORA-12170 / ORA-12541 | 호스트·포트 도달 불가. DB 서버 실행 여부, 방화벽 1521, 네트워크 확인 |
| ORA-12514 | 서비스명 오류. SID를 넣지 않았는지, `v$parameter` 의 service_names 값과 같은지 확인 |
| ORA-01017 | 계정 또는 비밀번호 오류 |
| ORA-00942 등 권한 오류 | 6장의 GRANT 적용 여부 확인 |
| DRCP 관련 연결 오류 | DRCP 체크를 끄고 다시 테스트 |
| LM 오류 `LM_UNREACHABLE` | LM Studio Local Server 실행 여부와 포트(1234) 확인 |
| LM 오류 `LM_NO_MODEL` | LM Studio에서 모델을 먼저 로드 |
| LM 오류 `LM_INVALID_RESPONSE` | 모델이 JSON으로 답하지 못한 경우. 더 큰 모델로 교체하거나 다시 실행 |
| LM 오류 `LM_TIMEOUT` | 120초 초과. 모델 크기, PC 부하 확인 |
| Windows 방화벽 팝업 | Node.js 통신 허용 (개인 네트워크). 에이전트는 127.0.0.1 전용이라 외부에 열리지 않습니다 |

## 10. 보안 메모

- 에이전트는 `127.0.0.1` 에만 바인딩됩니다. 같은 PC에서만 접속할 수 있고,
  외부에 공개되지 않습니다.
- DB 비밀번호는 어디에도 저장·기록되지 않습니다.
- 공용 PC라면 `OTUNE_API_TOKEN` 을 설정해 에이전트 API에도 잠금을 거는 것을
  권장합니다.
