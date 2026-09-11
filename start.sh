#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║  LEX — Sovereign AI Workbench · One-Command Setup & Launch         ║
# ║  Works on macOS and Linux. Installs only what's missing.           ║
# ╚══════════════════════════════════════════════════════════════════════╝
set -e

# ── Colours ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[  OK]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

# ── Resolve project root (directory where this script lives) ─────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
info "Project root: ${BOLD}$SCRIPT_DIR${NC}"

# ── Detect OS ────────────────────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
    Darwin) PLATFORM="macos" ;;
    Linux)  PLATFORM="linux" ;;
    *)      fail "Unsupported OS: $OS. Use start.bat for Windows." ;;
esac
info "Detected platform: ${BOLD}$PLATFORM${NC}"

# ── Helper: check if a command exists ────────────────────────────────
has() { command -v "$1" &>/dev/null; }

# ── Helper: install a package if missing ─────────────────────────────
ensure_installed() {
    local cmd="$1" brew_pkg="$2" apt_pkg="$3"
    if has "$cmd"; then
        ok "$cmd is already installed ($(command -v "$cmd"))"
        return 0
    fi
    warn "$cmd not found. Installing..."
    if [[ "$PLATFORM" == "macos" ]]; then
        if ! has brew; then
            info "Installing Homebrew first..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        fi
        brew install "$brew_pkg"
    elif [[ "$PLATFORM" == "linux" ]]; then
        if has apt-get; then
            sudo apt-get update -qq && sudo apt-get install -y "$apt_pkg"
        elif has dnf; then
            sudo dnf install -y "$apt_pkg"
        elif has pacman; then
            sudo pacman -Sy --noconfirm "$apt_pkg"
        else
            fail "No supported package manager found. Please install '$cmd' manually."
        fi
    fi
    has "$cmd" || fail "Failed to install $cmd. Please install it manually."
    ok "$cmd installed successfully"
}

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Step 1/7: Checking System Prerequisites${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"

# ── Python 3 ─────────────────────────────────────────────────────────
if has python3; then
    ok "Python 3 found ($(python3 --version 2>&1))"
elif has python; then
    PYVER="$(python --version 2>&1)"
    if [[ "$PYVER" == *"3."* ]]; then
        ok "Python 3 found as 'python' ($PYVER)"
        alias python3=python
    else
        ensure_installed python3 python3 python3
    fi
else
    ensure_installed python3 python3 python3
fi

# ── Node.js & npm ────────────────────────────────────────────────────
ensure_installed node node nodejs
ensure_installed npm node npm

# ── Tesseract OCR ────────────────────────────────────────────────────
ensure_installed tesseract tesseract tesseract-ocr

# ── Ollama ───────────────────────────────────────────────────────────
if has ollama; then
    ok "Ollama is already installed ($(command -v ollama))"
else
    warn "Ollama not found. Installing..."
    if [[ "$PLATFORM" == "macos" ]]; then
        brew install ollama
    else
        curl -fsSL https://ollama.com/install.sh | sh
    fi
    has ollama || fail "Failed to install Ollama. Visit https://ollama.com to install manually."
    ok "Ollama installed successfully"
fi

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Step 2/7: Python Virtual Environment${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"

if [ -d "venv" ] && [ -f "venv/bin/python" ]; then
    ok "Virtual environment already exists"
else
    info "Creating virtual environment..."
    python3 -m venv venv
    ok "Virtual environment created"
fi

# Activate venv
source venv/bin/activate
ok "Virtual environment activated"

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Step 3/7: Python Dependencies${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"

# Install/upgrade pip deps (pip is idempotent — skips already-installed)
info "Installing Python dependencies (skipping already installed)..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
ok "All Python dependencies ready"

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Step 4/7: Frontend Dependencies${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"

if [ -d "frontend/node_modules" ]; then
    ok "node_modules already exists — checking for updates..."
fi
info "Installing frontend dependencies (skipping already installed)..."
(cd frontend && npm install --silent 2>/dev/null)
ok "All frontend dependencies ready"

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Step 5/7: Ollama Models${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"

# Start Ollama if not already running
if curl -sf http://127.0.0.1:11434/api/tags &>/dev/null; then
    ok "Ollama server is already running"
else
    info "Starting Ollama server in background..."
    ollama serve &>/dev/null &
    OLLAMA_PID=$!
    sleep 3
    if curl -sf http://127.0.0.1:11434/api/tags &>/dev/null; then
        ok "Ollama server started (PID: $OLLAMA_PID)"
    else
        warn "Ollama may still be starting — continuing anyway"
    fi
fi

# Pull models only if not already pulled
pull_if_missing() {
    local model="$1"
    local pulled
    pulled=$(curl -sf http://127.0.0.1:11434/api/tags 2>/dev/null | grep -o "\"$model" || true)
    if [ -n "$pulled" ]; then
        ok "Model '$model' already pulled"
    else
        info "Pulling model '$model' (this may take a while on first run)..."
        ollama pull "$model"
        ok "Model '$model' pulled successfully"
    fi
}

pull_if_missing "qwen2.5:7b"
pull_if_missing "moondream"

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Step 6/7: Knowledge Base Ingestion${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"

if [ -d "data/lancedb_store" ] && [ "$(ls -A data/lancedb_store 2>/dev/null)" ]; then
    ok "LanceDB knowledge base already exists — skipping ingestion"
else
    info "Ingesting sample documents into knowledge base..."
    python -m backend.tools.ingest
    ok "Knowledge base ready"
fi

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Step 7/7: Launching Services${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"

# ── Cleanup handler ──────────────────────────────────────────────────
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo ""
    warn "Shutting down services..."
    [ -n "$BACKEND_PID" ]  && kill "$BACKEND_PID"  2>/dev/null && info "Backend stopped"
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null && info "Frontend stopped"
    # Kill child processes
    jobs -p | xargs -r kill 2>/dev/null
    echo -e "${GREEN}All services stopped. Goodbye!${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Start Backend ────────────────────────────────────────────────────
info "Starting backend server on port 8000..."
uvicorn backend.main:app --reload --port 8000 &
BACKEND_PID=$!
sleep 2

if kill -0 "$BACKEND_PID" 2>/dev/null; then
    ok "Backend running at ${BOLD}http://localhost:8000${NC}  (API docs: http://localhost:8000/docs)"
else
    fail "Backend failed to start. Check logs above."
fi

# ── Start Frontend ───────────────────────────────────────────────────
info "Starting frontend dev server..."
(cd frontend && npm run dev -- --port 8081) &
FRONTEND_PID=$!
sleep 3

if kill -0 "$FRONTEND_PID" 2>/dev/null; then
    ok "Frontend running at ${BOLD}http://localhost:8081${NC}"
else
    warn "Frontend may have picked a different port — check output above"
fi

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  ${GREEN}✓ LEX Sovereign AI Workbench is LIVE!${NC}${BOLD}                  ║${NC}"
echo -e "${BOLD}║                                                          ║${NC}"
echo -e "${BOLD}║  Frontend  → ${CYAN}http://localhost:8081${NC}${BOLD}                       ║${NC}"
echo -e "${BOLD}║  Backend   → ${CYAN}http://localhost:8000${NC}${BOLD}                       ║${NC}"
echo -e "${BOLD}║  API Docs  → ${CYAN}http://localhost:8000/docs${NC}${BOLD}                  ║${NC}"
echo -e "${BOLD}║                                                          ║${NC}"
echo -e "${BOLD}║  Login:  admin / admin123                                ║${NC}"
echo -e "${BOLD}║                                                          ║${NC}"
echo -e "${BOLD}║  Press ${RED}Ctrl+C${NC}${BOLD} to stop all services                       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Wait for background processes
wait
