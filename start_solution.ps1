# 오튠(ORCL-Tune) & LM Studio 통합 PowerShell 실행 스크립트
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host "    ⚡ 오튠(ORCL-Tune) & LM Studio 로컬 AI 원클릭 실행 스크립트" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. LM Studio 구동 확인
Write-Host "[1/3] LM Studio 로컬 AI 서버 실행 확인 중..." -ForegroundColor Yellow
$lmProcess = Get-Process -Name "LM Studio" -ErrorAction SilentlyContinue

if ($lmProcess) {
    Write-Host "   --> LM Studio가 이미 실행 중입니다." -ForegroundColor Green
} else {
    $lmPath = "$env:LOCALAPPDATA\Programs\LM-Studio\LM Studio.exe"
    if (Test-Path $lmPath) {
        Write-Host "   --> LM Studio를 실행합니다..." -ForegroundColor Green
        Start-Process -FilePath $lmPath
    } else {
        Write-Host "   [주의] LM Studio 설치 경로를 찾을 수 없습니다. 직접 실행해 주세요." -ForegroundColor Red
    }
}

Write-Host ""

# 2. Vite Web Server 실행
Write-Host "[2/3] 오튠 개발 서버(Vite)를 시작합니다..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" -WindowStyle Hidden

# 3. 브라우저 오픈
Write-Host "[3/3] 브라우저(http://localhost:5173/)를 엽니다..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
Start-Process "http://localhost:5173/"

Write-Host ""
Write-Host "=======================================================================" -ForegroundColor Green
Write-Host " ✅ 오튠 솔루션 및 LM Studio 구동 준비 완료!" -ForegroundColor Green
Write-Host " - 웹 접속 주소: http://localhost:5173/" -ForegroundColor Green
Write-Host "=======================================================================" -ForegroundColor Green
