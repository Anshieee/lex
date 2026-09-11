# backend/main.py
import os
import uuid
import shutil
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File as FastAPIFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from backend.agent.agent_graph import build_agent_graph
from backend.agent.model_registry import check_ollama_models
from backend.tools.network_monitor import get_network_status
from backend.tools.audit_logger import get_recent_entries, get_log_path, log_step
from backend.auth import (
    LoginRequest, TokenResponse, UserInfo,
    init_user_db, authenticate_user, create_token,
    get_current_user, require_admin,
)

agent_app = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent_app
    os.makedirs("data", exist_ok=True)
    os.makedirs("data/uploads", exist_ok=True)

    # Initialize auth user database
    init_user_db()

    # Initialize table schema and create checkpointer
    async with AsyncSqliteSaver.from_conn_string("data/workbench_state.db") as checkpointer:
        await checkpointer.setup()
        agent_app = build_agent_graph(checkpointer)
        yield

app = FastAPI(title="Sovereign AI Workbench", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SubmitTaskRequest(BaseModel):
    prompt: str
    files: Optional[List[str]] = []

class ApproveTaskRequest(BaseModel):
    approved: bool

@app.get("/")
async def root():
    return {"status": "online", "docs": "/docs"}

# ── Auth Endpoints ───────────────────────────────────────────────────

@app.post("/api/auth/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    """Authenticate user against local SQLite store and return JWT."""
    user = authenticate_user(req.username, req.password)
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password",
        )
    token = create_token(user)
    log_step(
        task_id="auth",
        step_type="login",
        input_summary=f"User '{req.username}' logged in",
        user=req.username,
    )
    return TokenResponse(
        access_token=token,
        user=UserInfo(**user),
    )

@app.get("/api/auth/me", response_model=UserInfo)
async def get_me(user: dict = Depends(get_current_user)):
    """Return current user info from JWT token."""
    return UserInfo(**user)

# ── Task Endpoints (Protected) ───────────────────────────────────────

@app.post("/api/tasks/submit")
async def submit_task(req: SubmitTaskRequest, user: dict = Depends(get_current_user)):
    if agent_app is None:
        raise HTTPException(status_code=503, detail="Agent system initializing")

    task_id = str(uuid.uuid4())[:8]
    config = {"configurable": {"thread_id": task_id}}

    log_step(
        task_id=task_id,
        step_type="task_submitted",
        input_summary=req.prompt[:200],
        user=user["username"],
    )

    initial_state = {
        "task_id": task_id,
        "user_prompt": req.prompt,
        "attached_files": req.files or [],
        "completed_subtask_ids": [],
        "results": [],
        "current_subtask": None,
        "needs_human_approval": False,
        "final_output": None,
        "deliverable_path": None
    }

    # Runs until interrupt_before=["execute_tool"] or END
    try:
        await agent_app.ainvoke(initial_state, config=config)
    except Exception as e:
        log_step(
            task_id=task_id,
            step_type="task_error",
            input_summary=req.prompt[:200],
            output_summary=str(e)[:300],
            status="failed",
            user=user["username"],
        )
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {str(e)}")

    state = await agent_app.aget_state(config)
    is_paused = len(state.next) > 0 and "approval_gate" in state.next
    return {
        "task_id": task_id,
        "status": "waiting_approval" if is_paused else "completed",
        "state": state.values
    }

@app.get("/api/tasks/{task_id}/status")
async def get_task_status(task_id: str, user: dict = Depends(get_current_user)):
    if agent_app is None:
        raise HTTPException(status_code=503, detail="Agent system initializing")

    config = {"configurable": {"thread_id": task_id}}
    state = await agent_app.aget_state(config)

    if not state or not state.values:
        raise HTTPException(status_code=404, detail="Task not found")

    return {
        "task_id": task_id,
        "is_paused": len(state.next) > 0,
        "next_node": state.next,
        "values": state.values
    }

@app.post("/api/tasks/{task_id}/approve")
async def approve_and_resume(task_id: str, req: ApproveTaskRequest, user: dict = Depends(get_current_user)):
    if agent_app is None:
        raise HTTPException(status_code=503, detail="Agent system initializing")

    config = {"configurable": {"thread_id": task_id}}
    state = await agent_app.aget_state(config)

    if not state or len(state.next) == 0:
        raise HTTPException(status_code=400, detail="Task is not waiting for approval")

    log_step(
        task_id=task_id,
        step_type="approval",
        input_summary=f"{'Approved' if req.approved else 'Rejected'} by {user['username']}",
        user=user["username"],
    )

    if not req.approved:
        return {"status": "rejected", "message": "Subtask rejected by operator."}

    # Resume graph execution and await full run to completion/interrupt
    try:
        await agent_app.ainvoke(None, config=config)
    except Exception as e:
        log_step(
            task_id=task_id,
            step_type="approval_error",
            output_summary=str(e)[:300],
            status="failed",
            user=user["username"],
        )
        raise HTTPException(status_code=500, detail=f"Agent resume failed: {str(e)}")
    
    # Reload fresh checkpoint from SQLite
    current_state = await agent_app.aget_state(config)
    is_paused = bool(current_state.next)

    return {
        "task_id": task_id,
        "status": "waiting_approval" if is_paused else "completed",
        "state": current_state.values
    }

@app.get("/api/tasks/{task_id}/download")
async def download_deliverable(task_id: str, user: dict = Depends(get_current_user)):
    if agent_app is None:
        raise HTTPException(status_code=503, detail="Agent system initializing")

    config = {"configurable": {"thread_id": task_id}}
    state = await agent_app.aget_state(config)

    file_path = state.values.get("deliverable_path")
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Deliverable not generated yet")

    return FileResponse(
        file_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=os.path.basename(file_path)
    )

@app.get("/api/tasks/{task_id}/download/xlsx")
async def download_xlsx_deliverable(task_id: str, user: dict = Depends(get_current_user)):
    """Download the Excel deliverable for a completed task."""
    if agent_app is None:
        raise HTTPException(status_code=503, detail="Agent system initializing")

    config = {"configurable": {"thread_id": task_id}}
    state = await agent_app.aget_state(config)

    # Try xlsx path: same name as docx but with .xlsx extension
    docx_path = state.values.get("deliverable_path", "")
    xlsx_path = docx_path.replace(".docx", ".xlsx") if docx_path else ""

    if not xlsx_path or not os.path.exists(xlsx_path):
        raise HTTPException(status_code=404, detail="Excel deliverable not generated yet")

    return FileResponse(
        xlsx_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=os.path.basename(xlsx_path)
    )

# ── File Upload (Protected) ─────────────────────────────────────────

@app.post("/api/files/upload")
async def upload_files(files: List[UploadFile] = FastAPIFile(...), user: dict = Depends(get_current_user)):
    """Accept multipart file uploads and store them for agent processing."""
    saved = []
    for f in files:
        safe_name = os.path.basename(f.filename or "unnamed")
        dest = os.path.join("data", "uploads", safe_name)
        with open(dest, "wb") as out:
            content = await f.read()
            out.write(content)
        saved.append({"filename": safe_name, "path": dest, "size": len(content)})

    log_step(
        task_id="upload",
        step_type="file_upload",
        input_summary=f"Uploaded {len(saved)} file(s): {', '.join(s['filename'] for s in saved)}",
        user=user["username"],
    )
    return {"uploaded": saved}

# ── Model Registry (Unprotected — needed by drawer before login) ─────

@app.get("/api/models")
async def list_models():
    """Return available models with live Ollama availability check."""
    models = await check_ollama_models()
    return {"models": models}

# ── Network Sovereignty Monitor (Unprotected — always visible) ───────

@app.get("/api/network/status")
async def network_status():
    """Real-time sovereign proof — reads /proc/net/tcp for actual connections."""
    return get_network_status()

# ── Audit Log (Admin only) ───────────────────────────────────────────

@app.get("/api/audit/log")
async def get_audit_log(n: int = 50, user: dict = Depends(require_admin)):
    """Return the last N audit log entries. Admin only."""
    entries = get_recent_entries(n)
    return {"entries": entries, "total": len(entries)}

@app.get("/api/audit/log/download")
async def download_audit_log(user: dict = Depends(require_admin)):
    """Download the full audit log JSONL file. Admin only."""
    log_path = get_log_path()
    if not os.path.exists(log_path):
        raise HTTPException(status_code=404, detail="No audit log exists yet")
    return FileResponse(
        log_path,
        media_type="application/jsonl",
        filename="audit_log.jsonl"
    )
