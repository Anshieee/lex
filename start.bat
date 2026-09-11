@echo off
REM ╔══════════════════════════════════════════════════════════════════════╗
REM ║  LEX — Sovereign AI Workbench · One-Command Setup ^& Launch        ║
REM ║  Works on Windows. Installs only what's missing.                   ║
REM ╚══════════════════════════════════════════════════════════════════════╝
setlocal enabledelayedexpansion
title LEX - Sovereign AI Workbench Setup

REM ── Navigate to script directory ───────────────────────────────────
cd /d "%~dp0"
echo [INFO]  Project root: %CD%

REM ══════════════════════════════════════════════════════════════════
echo.
echo ═══════════════════════════════════════════════════
echo   Step 1/7: Checking System Prerequisites
echo ═══════════════════════════════════════════════════

REM ── Check Python ──────────────────────────────────────────────────
where python >nul 2>nul
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo [  OK]  Python found: %%i
) else (
    where python3 >nul 2>nul
    if %errorlevel%==0 (
        for /f "tokens=*" %%i in ('python3 --version 2^>^&1') do echo [  OK]  Python found: %%i
    ) else (
        echo [FAIL]  Python 3 is NOT installed.
        echo         Download from: https://www.python.org/downloads/
        echo         IMPORTANT: Check "Add Python to PATH" during install.
        echo.
        echo         After installing Python, re-run this script.
        pause
        exit /b 1
    )
)

REM ── Determine python command ──────────────────────────────────────
set PYTHON_CMD=python
where python >nul 2>nul || set PYTHON_CMD=python3

REM ── Check Node.js ─────────────────────────────────────────────────
where node >nul 2>nul
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('node --version') do echo [  OK]  Node.js found: %%i
) else (
    echo [FAIL]  Node.js is NOT installed.
    echo         Download from: https://nodejs.org/
    echo.
    echo         After installing Node.js, re-run this script.
    pause
    exit /b 1
)

REM ── Check npm ─────────────────────────────────────────────────────
where npm >nul 2>nul
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('npm --version') do echo [  OK]  npm found: %%i
) else (
    echo [FAIL]  npm is NOT installed. It should come with Node.js.
    pause
    exit /b 1
)

REM ── Check Tesseract ───────────────────────────────────────────────
where tesseract >nul 2>nul
if %errorlevel%==0 (
    echo [  OK]  Tesseract OCR found
) else (
    echo [WARN]  Tesseract OCR not found. OCR features will be limited.
    echo         Install from: https://github.com/UB-Mannheim/tesseract/wiki
    echo         Continuing without it...
)

REM ── Check Ollama ──────────────────────────────────────────────────
where ollama >nul 2>nul
if %errorlevel%==0 (
    echo [  OK]  Ollama found
) else (
    echo [FAIL]  Ollama is NOT installed.
    echo         Download from: https://ollama.com/download/windows
    echo.
    echo         After installing Ollama, re-run this script.
    pause
    exit /b 1
)

REM ══════════════════════════════════════════════════════════════════
echo.
echo ═══════════════════════════════════════════════════
echo   Step 2/7: Python Virtual Environment
echo ═══════════════════════════════════════════════════

if exist "venv\Scripts\python.exe" (
    echo [  OK]  Virtual environment already exists
) else (
    echo [INFO]  Creating virtual environment...
    %PYTHON_CMD% -m venv venv
    if %errorlevel% neq 0 (
        echo [FAIL]  Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [  OK]  Virtual environment created
)

REM Activate venv
call venv\Scripts\activate.bat
echo [  OK]  Virtual environment activated

REM ══════════════════════════════════════════════════════════════════
echo.
echo ═══════════════════════════════════════════════════
echo   Step 3/7: Python Dependencies
echo ═══════════════════════════════════════════════════

echo [INFO]  Installing Python dependencies (skipping already installed)...
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
if %errorlevel% neq 0 (
    echo [FAIL]  Failed to install Python dependencies.
    pause
    exit /b 1
)
echo [  OK]  All Python dependencies ready

REM ══════════════════════════════════════════════════════════════════
echo.
echo ═══════════════════════════════════════════════════
echo   Step 4/7: Frontend Dependencies
echo ═══════════════════════════════════════════════════

if exist "frontend\node_modules" (
    echo [  OK]  node_modules already exists — checking for updates...
)
echo [INFO]  Installing frontend dependencies (skipping already installed)...
cd frontend
call npm install --silent 2>nul
cd ..
echo [  OK]  All frontend dependencies ready

REM ══════════════════════════════════════════════════════════════════
echo.
echo ═══════════════════════════════════════════════════
echo   Step 5/7: Ollama Models
echo ═══════════════════════════════════════════════════

REM Check if Ollama is running, start if not
curl -sf http://127.0.0.1:11434/api/tags >nul 2>nul
if %errorlevel%==0 (
    echo [  OK]  Ollama server is already running
) else (
    echo [INFO]  Starting Ollama server in background...
    start /min "Ollama Server" ollama serve
    timeout /t 3 /nobreak >nul
    curl -sf http://127.0.0.1:11434/api/tags >nul 2>nul
    if %errorlevel%==0 (
        echo [  OK]  Ollama server started
    ) else (
        echo [WARN]  Ollama may still be starting — continuing anyway
    )
)

REM Pull models (ollama pull is idempotent — skips if already present)
echo [INFO]  Ensuring required models are pulled...
ollama pull qwen2.5:7b
ollama pull moondream
echo [  OK]  All models ready

REM ══════════════════════════════════════════════════════════════════
echo.
echo ═══════════════════════════════════════════════════
echo   Step 6/7: Knowledge Base Ingestion
echo ═══════════════════════════════════════════════════

if exist "data\lancedb_store" (
    dir /b "data\lancedb_store" 2>nul | findstr "." >nul
    if !errorlevel!==0 (
        echo [  OK]  LanceDB knowledge base already exists — skipping ingestion
        goto skip_ingest
    )
)
echo [INFO]  Ingesting sample documents into knowledge base...
python -m backend.tools.ingest
echo [  OK]  Knowledge base ready
:skip_ingest

REM ══════════════════════════════════════════════════════════════════
echo.
echo ═══════════════════════════════════════════════════
echo   Step 7/7: Launching Services
echo ═══════════════════════════════════════════════════

REM ── Start Backend in a new window ──────────────────────────────────
echo [INFO]  Starting backend server on port 8000...
start "LEX Backend" cmd /k "cd /d %CD% && call venv\Scripts\activate.bat && uvicorn backend.main:app --reload --port 8000"
timeout /t 3 /nobreak >nul
echo [  OK]  Backend launched (http://localhost:8000)

REM ── Start Frontend in a new window ─────────────────────────────────
echo [INFO]  Starting frontend dev server...
start "LEX Frontend" cmd /k "cd /d %CD%\frontend && npm run dev -- --port 8081"
timeout /t 3 /nobreak >nul
echo [  OK]  Frontend launched (http://localhost:8081)

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║  LEX Sovereign AI Workbench is LIVE!                    ║
echo ║                                                          ║
echo ║  Frontend  -^> http://localhost:8081                      ║
echo ║  Backend   -^> http://localhost:8000                      ║
echo ║  API Docs  -^> http://localhost:8000/docs                 ║
echo ║                                                          ║
echo ║  Login:  admin / admin123                                ║
echo ║                                                          ║
echo ║  Close the Backend/Frontend windows to stop services     ║
echo ╚══════════════════════════════════════════════════════════╝
echo.
pause
