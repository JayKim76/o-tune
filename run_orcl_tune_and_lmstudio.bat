@echo off
chcp 65001 > NUL
title 오튠(ORCL-Tune) + LM Studio 원클릭 자동 실행기

echo =======================================================================
echo     ⚡ 오튠(ORCL-Tune) & LM Studio 로컬 AI 통합 원클릭 실행 스크립트
echo =======================================================================
echo.

:: 1. LM Studio 로컬 AI 앱 자동 탐색 및 실행
echo [1/3] LM Studio 로컬 AI 서버 실행 상태 확인 중...

tasklist /FI "IMAGENAME eq LM Studio.exe" 2>NUL | find /I /N "LM Studio.exe" >NUL
if "%ERRORLEVEL%"=="0" (
    echo    --> LM Studio가 이미 실행 중입니다.
) else (
    echo    --> LM Studio를 구동합니다...
    if exist "%LOCALAPPDATA%\Programs\LM-Studio\LM Studio.exe" (
        start "" "%LOCALAPPDATA%\Programs\LM-Studio\LM Studio.exe"
    ) else if exist "C:\Program Files\LM-Studio\LM Studio.exe" (
        start "" "C:\Program Files\LM-Studio\LM Studio.exe"
    ) else (
        echo    [주의] LM Studio 표준 설치 경로를 찾을 수 없습니다.
        echo    [안내] LM Studio를 직접 구동하신 후 [Developer -> Start Server]를 켜주세요.
    )
)

echo.

:: 2. 오튠(ORCL-Tune) Vite 개발 서버 백그라운드 구동
echo [2/3] 오튠 오라클 튜닝 솔루션(Vite Web Server) 구동 중...
start /b cmd /c "npm run dev"

echo.

:: 3. 브라우저 자동 오픈
echo [3/3] 웹 브라우저에서 오튠 솔루션을 엽니다 (http://localhost:5173/)...
timeout /t 3 /nobreak > NUL
start http://localhost:5173/

echo.
echo =======================================================================
echo  ✅ 성공적으로 실행되었습니다!
echo  - 오튠 주소: http://localhost:5173/
echo  - LM Studio API: http://localhost:1234
echo.
echo  이 창을 닫으면 개발 서버가 종료될 수 있으니 창을 유지해 주세요.
echo =======================================================================
pause
