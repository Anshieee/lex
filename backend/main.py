# backend/main.py
import os
import uuid
import shutil
import time
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
from backend.tools.rag_engine import ingest_pdf_file, ingest_directory, tool_search_knowledge_base
from backend.auth import (
    LoginRequest, TokenResponse, UserInfo,
    init_user_db, authenticate_user, create_token,
    get_current_user, require_admin,
)
from backend.agent.schemas import RoutingWeights, PromptCompressionConfig
from backend.agent.model_registry import calculate_routing_scores, check_ollama_models

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
    routing_weights: Optional[RoutingWeights] = None
    prompt_compression: Optional[PromptCompressionConfig] = None


class UserPreferencesRequest(BaseModel):
    routing_weights: Optional[RoutingWeights] = None
    prompt_compression: Optional[PromptCompressionConfig] = None

class ApproveTaskRequest(BaseModel):
    approved: bool

class IngestRequest(BaseModel):
    file_path: str
    doc_type: str = "sop"

class IngestDirRequest(BaseModel):
    dir_path: str
    doc_type: str = "sop"

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
        "deliverable_path": None,
        "routing_weights": req.routing_weights,
        "prompt_compression": req.prompt_compression
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
        # Idempotency: if task is not waiting for approval, it's already been processed
        # Return current state instead of error
        if state and state.values:
            is_paused = len(state.next) > 0 and "approval_gate" in state.next
            return {
                "task_id": task_id,
                "status": "waiting_approval" if is_paused else "completed",
                "state": state.values,
                "message": "Task already processed" if not is_paused else "Task waiting for approval"
            }
        raise HTTPException(status_code=404, detail="Task not found")

    # Check if already approved/rejected (idempotency)
    # Need to check BOTH state.next AND state.values.needs_human_approval
    # because graph might not have advanced past gate yet
    values_need_approval = state.values.get("needs_human_approval", False) if state.values else False
    if "approval_gate" not in state.next or not values_need_approval:
        is_paused = len(state.next) > 0 and "approval_gate" in state.next
        return {
            "task_id": task_id,
            "status": "waiting_approval" if is_paused else "completed",
            "state": state.values,
            "message": "Approval already processed"
        }

    log_step(
        task_id=task_id,
        step_type="approval",
        input_summary=f"{'Approved' if req.approved else 'Rejected'} by {user['username']}",
        user=user["username"],
    )

    if not req.approved:
        # For rejection, we need to mark the task as completed/rejected in the graph
        # to prevent it from staying stuck in the checkpoint
        # Update state to mark as rejected and resume to END
        try:
            # Update the checkpoint to skip the approval gate
            await agent_app.aupdate_state(
                config,
                {"needs_human_approval": False, "current_subtask": None},
                as_node="approval_gate"
            )
        except Exception:
            pass  # Best effort
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

# ── RAG Ingestion API (Protected) ────────────────────────────────────

@app.post("/api/rag/ingest")
async def ingest_document(req: IngestRequest, user: dict = Depends(get_current_user)):
    """Ingest a single PDF document into LanceDB for RAG retrieval."""
    try:
        count = ingest_pdf_file(req.file_path, doc_type=req.doc_type)
        log_step(
            task_id="rag",
            step_type="ingest",
            input_summary=f"Ingested {req.file_path} ({count} chunks)",
            user=user["username"],
        )
        return {"status": "success", "chunks": count, "file": req.file_path}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        log_step(
            task_id="rag",
            step_type="ingest_error",
            input_summary=f"Failed to ingest {req.file_path}",
            output_summary=str(e)[:300],
            status="failed",
            user=user["username"],
        )
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")


@app.post("/api/rag/ingest/directory")
async def ingest_directory_endpoint(req: IngestDirRequest, user: dict = Depends(get_current_user)):
    """Batch ingest all PDFs in a directory."""
    try:
        results = ingest_directory(req.dir_path, doc_type=req.doc_type)
        log_step(
            task_id="rag",
            step_type="ingest_directory",
            input_summary=f"Ingested directory {req.dir_path}: {results}",
            user=user["username"],
        )
        return {"status": "success", "results": results}
    except Exception as e:
        log_step(
            task_id="rag",
            step_type="ingest_error",
            input_summary=f"Failed to ingest directory {req.dir_path}",
            output_summary=str(e)[:300],
            status="failed",
            user=user["username"],
        )
        raise HTTPException(status_code=500, detail=f"Directory ingestion failed: {str(e)}")


@app.get("/api/rag/search")
async def search_knowledge_base(q: str, top_k: int = 3, doc_type: Optional[str] = None, user: dict = Depends(get_current_user)):
    """Search the LanceDB knowledge base."""
    result = tool_search_knowledge_base(query=q, top_k=top_k, doc_type=doc_type)
    return result

# ── Model Registry (Unprotected — needed by drawer before login) ─────

@app.get("/api/models")
async def list_models():
    """Return available models with live Ollama availability check."""
    models = await check_ollama_models()
    return {"models": models}


@app.post("/api/models/routing-scores")
async def get_routing_scores(weights: RoutingWeights):
    """Calculate and return model routing scores based on user-provided weights.

    Used by the frontend's Models page to show live scoring when user adjusts sliders.
    """
    scored = calculate_routing_scores(weights)
    return {"scores": scored, "weights_used": weights.model_dump()}


@app.get("/api/models/routing-scores")
async def get_default_routing_scores():
    """Return default routing scores (balanced weights)."""
    default_weights = RoutingWeights()
    scored = calculate_routing_scores(default_weights)
    return {"scores": scored, "weights_used": default_weights.model_dump()}

# ── User Preferences (Protected) ─────────────────────────────────────

# In-memory preferences store (persists for server lifetime)
_user_preferences: dict[str, dict] = {}

@app.put("/api/user/preferences")
async def set_user_preferences(req: UserPreferencesRequest, user: dict = Depends(get_current_user)):
    """Save user's routing weights and prompt compression preferences."""
    username = user["username"]
    prefs = {}
    if req.routing_weights:
        prefs["routing_weights"] = req.routing_weights.model_dump()
    if req.prompt_compression:
        prefs["prompt_compression"] = req.prompt_compression.model_dump()

    _user_preferences[username] = prefs

    log_step(
        task_id="preferences",
        step_type="user_preferences",
        input_summary=f"Updated preferences for user '{username}'",
        user=username,
    )
    return {"status": "success", "message": "Preferences saved"}


@app.get("/api/user/preferences")
async def get_user_preferences(user: dict = Depends(get_current_user)):
    """Retrieve user's current preferences (default values if not set)."""
    username = user["username"]
    if username in _user_preferences:
        return _user_preferences[username]
    return {
        "routing_weights": RoutingWeights().model_dump(),
        "prompt_compression": PromptCompressionConfig().model_dump(),
    }


# ── Health Check (Unprotected — for monitoring) ──────────────────────

@app.get("/api/health")
async def health_check():
    """Health check endpoint verifying Ollama, database, and agent graph availability."""
    import httpx
    health = {
        "status": "healthy",
        "timestamp": time.time(),
        "checks": {}
    }

    # Check Ollama
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get("http://127.0.0.1:11434/api/tags")
            if res.status_code == 200:
                models = res.json().get("models", [])
                health["checks"]["ollama"] = {"status": "ok", "models_count": len(models)}
            else:
                health["checks"]["ollama"] = {"status": "degraded", "error": f"HTTP {res.status_code}"}
                health["status"] = "degraded"
    except Exception as e:
        health["checks"]["ollama"] = {"status": "failed", "error": str(e)}
        health["status"] = "degraded"

    # Check database (SQLite)
    try:
        import sqlite3
        conn = sqlite3.connect("data/workbench_state.db")
        conn.execute("SELECT 1").fetchone()
        conn.close()
        health["checks"]["database"] = {"status": "ok"}
    except Exception as e:
        health["checks"]["database"] = {"status": "failed", "error": str(e)}
        health["status"] = "degraded"

    # Check agent graph
    if agent_app is not None:
        health["checks"]["agent_graph"] = {"status": "ok"}
    else:
        health["checks"]["agent_graph"] = {"status": "initializing"}
        health["status"] = "degraded"

    return health


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

# ── Analytics Dashboard (Admin only) ─────────────────────────────────────

@app.get("/api/analytics")
async def get_analytics(hours: int = 24, user: dict = Depends(require_admin)):
    """
    Aggregated analytics from audit log for dashboard charts.
    Returns latency, success rates, token counts per model/task type.
    """
    from datetime import datetime, timedelta, timezone
    import json
    from collections import defaultdict

    log_path = get_log_path()
    if not os.path.exists(log_path):
        return {
            "summary": {"total_requests": 0, "success_rate": 0, "avg_latency_ms": 0},
            "by_model": {},
            "by_task_type": {},
            "time_series": [],
        }

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    entries = []

    with open(log_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                ts = datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00"))
                if ts >= cutoff:
                    entries.append(entry)
            except (json.JSONDecodeError, KeyError, ValueError):
                continue

    if not entries:
        return {
            "summary": {"total_requests": 0, "success_rate": 0, "avg_latency_ms": 0},
            "by_model": {},
            "by_task_type": {},
            "time_series": [],
        }

    # Aggregate by model
    by_model = defaultdict(lambda: {"requests": 0, "successes": 0, "total_latency": 0, "total_tokens_in": 0, "total_tokens_out": 0})

    # Aggregate by task type (step_type)
    by_task = defaultdict(lambda: {"requests": 0, "successes": 0, "total_latency": 0})

    # Time series (hourly buckets)
    hourly = defaultdict(lambda: {"requests": 0, "successes": 0, "total_latency": 0})

    for e in entries:
        model = e.get("model_used", "unknown")
        task = e.get("step_type", "unknown")
        latency = e.get("duration_ms", 0)
        status = e.get("status", "unknown")
        ts = datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00"))
        hour_key = ts.replace(minute=0, second=0, microsecond=0).isoformat()

        # By model
        by_model[model]["requests"] += 1
        if status == "success":
            by_model[model]["successes"] += 1
        by_model[model]["total_latency"] += latency

        # By task type
        by_task[task]["requests"] += 1
        if status == "success":
            by_task[task]["successes"] += 1
        by_task[task]["total_latency"] += latency

        # Time series
        hourly[hour_key]["requests"] += 1
        if status == "success":
            hourly[hour_key]["successes"] += 1
        hourly[hour_key]["total_latency"] += latency

    # Compute derived metrics
    model_stats = {}
    for model, stats in by_model.items():
        reqs = stats["requests"]
        model_stats[model] = {
            "requests": reqs,
            "success_rate": round(stats["successes"] / reqs * 100, 1) if reqs > 0 else 0,
            "avg_latency_ms": round(stats["total_latency"] / reqs, 1) if reqs > 0 else 0,
        }

    task_stats = {}
    for task, stats in by_task.items():
        reqs = stats["requests"]
        task_stats[task] = {
            "requests": reqs,
            "success_rate": round(stats["successes"] / reqs * 100, 1) if reqs > 0 else 0,
            "avg_latency_ms": round(stats["total_latency"] / reqs, 1) if reqs > 0 else 0,
        }

    # Time series sorted
    time_series = []
    for hour in sorted(hourly.keys()):
        stats = hourly[hour]
        reqs = stats["requests"]
        time_series.append({
            "hour": hour,
            "requests": reqs,
            "success_rate": round(stats["successes"] / reqs * 100, 1) if reqs > 0 else 0,
            "avg_latency_ms": round(stats["total_latency"] / reqs, 1) if reqs > 0 else 0,
        })

    total = len(entries)
    successes = sum(1 for e in entries if e.get("status") == "success")
    total_latency = sum(e.get("duration_ms", 0) for e in entries)

    return {
        "summary": {
            "total_requests": total,
            "success_rate": round(successes / total * 100, 1) if total > 0 else 0,
            "avg_latency_ms": round(total_latency / total, 1) if total > 0 else 0,
        },
        "by_model": model_stats,
        "by_task_type": task_stats,
        "time_series": time_series,
    }


@app.get("/api/models/stats")
async def get_model_stats(hours: int = 24, user: dict = Depends(require_admin)):
    """
    Per-model usage statistics from audit log.
    Returns request count, success rate, avg latency per model.
    """
    from datetime import datetime, timedelta, timezone
    import json
    from collections import defaultdict

    log_path = get_log_path()
    if not os.path.exists(log_path):
        return {"models": {}}

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    entries = []

    with open(log_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                ts = datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00"))
                if ts >= cutoff:
                    entries.append(entry)
            except (json.JSONDecodeError, KeyError, ValueError):
                continue

    by_model = defaultdict(lambda: {"requests": 0, "successes": 0, "total_latency": 0, "task_types": defaultdict(int)})

    for e in entries:
        model = e.get("model_used", "unknown")
        task = e.get("step_type", "unknown")
        latency = e.get("duration_ms", 0)
        status = e.get("status", "unknown")

        by_model[model]["requests"] += 1
        if status == "success":
            by_model[model]["successes"] += 1
        by_model[model]["total_latency"] += latency
        by_model[model]["task_types"][task] += 1

    models = {}
    for model, stats in by_model.items():
        reqs = stats["requests"]
        models[model] = {
            "requests": reqs,
            "success_rate": round(stats["successes"] / reqs * 100, 1) if reqs > 0 else 0,
            "avg_latency_ms": round(stats["total_latency"] / reqs, 1) if reqs > 0 else 0,
            "task_types": dict(stats["task_types"]),
        }

    return {"models": models}
