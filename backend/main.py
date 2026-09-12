# backend/main.py
import asyncio
import json
import os
import time
import uuid
import shutil
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File as FastAPIFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from backend.agent.agent_graph import build_agent_graph, register_token_callback, unregister_token_callback
from backend.agent.model_registry import check_ollama_models
from backend.agent.intent_classifier import classify_intent
from backend.agent.llm_client import stream_local_llm, LLMMetrics
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

    # Auto-ingest any existing PDFs into LanceDB for RAG search
    try:
        from backend.tools.rag_engine import ingest_directory, get_or_create_table
        table = get_or_create_table()
        existing_count = table.count_rows()
        total_ingested = 0

        # Ingest from assets/ (sample documents)
        if os.path.exists("assets"):
            res = ingest_directory("assets", doc_type="sample")
            for fname, count in res.items():
                total_ingested += count
                print(f"  [Ingest] assets/{fname}: {count} chunks")

        # Ingest from data/uploads/ (user-uploaded files)
        if os.path.exists("data/uploads"):
            res = ingest_directory("data/uploads", doc_type="uploaded")
            for fname, count in res.items():
                total_ingested += count
                print(f"  [Ingest] uploads/{fname}: {count} chunks")

        final_count = table.count_rows()
        print(f"[LanceDB] Startup ingest complete: {total_ingested} new chunks, {final_count} total rows")
    except Exception as e:
        print(f"[LanceDB] Startup ingest warning: {e}")

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

# ── Node name → human-readable status mapping ───────────────────────
NODE_LABELS = {
    "planner": "Planning task decomposition...",
    "router": "Routing to next subtask...",
    "approval_gate": "Awaiting human approval...",
    "execute_tool": "Executing subtask...",
    "synthesize": "Generating final response...",
}

def _subtask_label(state_values: dict) -> str:
    """Generate a human-readable label for the current subtask."""
    subtask = state_values.get("current_subtask")
    if subtask:
        task_type = subtask.get("task_type", "") if isinstance(subtask, dict) else getattr(subtask, "task_type", "")
        type_labels = {
            "rag_retrieval": "Searching knowledge base...",
            "vision_ocr": "Running OCR extraction...",
            "code_execution": "Executing calculations...",
            "general_reasoning": "Synthesizing findings...",
        }
        return type_labels.get(task_type, f"Running {task_type}...")
    return "Processing..."

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
        "response_text": None,
        "generation_metrics": None,
    }

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

# ── SSE Streaming Endpoint (with Intent Routing) ─────────────────────

@app.post("/api/tasks/submit/stream")
async def submit_task_stream(req: SubmitTaskRequest, user: dict = Depends(get_current_user)):
    """
    Stream real-time SSE events.
    - Conversational prompts: bypass LangGraph, stream Ollama tokens directly.
    - Agentic prompts: run full LangGraph pipeline with token streaming on synthesis.
    """
    if agent_app is None:
        raise HTTPException(status_code=503, detail="Agent system initializing")

    task_id = str(uuid.uuid4())[:8]

    log_step(
        task_id=task_id,
        step_type="task_submitted_stream",
        input_summary=req.prompt[:200],
        user=user["username"],
    )


    # ── Main SSE generator with intent routing ───────────────────────
    async def full_generator():
        yield _sse_event("task_started", {
            "task_id": task_id,
            "timestamp": time.time(),
        })

        intent_result = await classify_intent(req.prompt, req.files)

        yield _sse_event("intent_classified", {
            "intent": intent_result.intent,
            "confidence": intent_result.confidence,
            "method": intent_result.method,
        })

        log_step(
            task_id=task_id,
            step_type="intent_classified",
            input_summary=req.prompt[:200],
            output_summary=f"{intent_result.intent} (conf={intent_result.confidence}, via={intent_result.method})",
            user=user["username"],
        )

        if intent_result.intent == "conversational":
            async for event in _stream_conversational(task_id, req.prompt, user["username"]):
                yield event
        else:
            async for event in _stream_agentic(task_id, req, user["username"]):
                yield event

    return StreamingResponse(
        full_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _stream_conversational(task_id: str, prompt: str, username: str):
    """Stream a conversational response directly from Ollama — no LangGraph pipeline."""
    yield _sse_event("step_start", {
        "node": "conversational",
        "description": "Generating response...",
        "timestamp": time.time(),
    })

    full_text = ""
    final_metrics = None

    try:
        async for chunk in stream_local_llm(
            prompt=prompt,
            system_prompt=(
                "You are LEX, a sovereign on-premise AI assistant for industrial operations. "
                "You are helpful, concise, and technically precise. You run entirely on local hardware "
                "with no external API calls. Respond naturally using markdown formatting when appropriate."
            ),
            temperature=0.3,
        ):
            if isinstance(chunk, LLMMetrics):
                final_metrics = chunk
            else:
                full_text += chunk
                yield _sse_event("token_delta", {"token": chunk})

        # Emit completion event
        metrics_dict = None
        if final_metrics:
            metrics_dict = {
                "total_tokens_in": final_metrics.tokens_in,
                "total_tokens_out": final_metrics.tokens_out,
                "avg_tokens_per_sec": final_metrics.eval_tokens_per_sec,
                "total_duration_ms": final_metrics.duration_ms,
                "model": final_metrics.model,
            }

        yield _sse_event("token_done", {
            "full_text": full_text,
            "metrics": metrics_dict,
        })

        log_step(
            task_id=task_id,
            step_type="conversational_response",
            output_summary=full_text[:300],
            user=username,
        )

    except Exception as e:
        log_step(
            task_id=task_id,
            step_type="task_error",
            output_summary=str(e)[:300],
            status="failed",
            user=username,
        )
        yield _sse_event("error", {"message": str(e), "task_id": task_id})
        return

    yield _sse_event("done", {
        "task_id": task_id,
        "status": "completed",
    })


async def _stream_agentic(task_id: str, req: SubmitTaskRequest, username: str):
    """Run the full LangGraph pipeline with SSE streaming + token streaming on synthesis."""
    config = {"configurable": {"thread_id": task_id}}

    # Queue for streaming tokens from synthesize_deliverable_node
    token_queue: asyncio.Queue = asyncio.Queue()

    async def token_callback(token: str):
        """Push token into the queue for the SSE generator to consume."""
        await token_queue.put(token)

    # Register callback so synthesize_deliverable_node can find it by task_id
    register_token_callback(task_id, token_callback)

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
        "response_text": None,
        "generation_metrics": None,
    }

    try:
        prev_node = None
        is_synthesizing = False

        async for event in agent_app.astream(initial_state, config=config, stream_mode="updates"):
            for node_name, node_output in event.items():
                # Emit step_start for each node
                if node_name != prev_node:
                    current_state = await agent_app.aget_state(config)
                    label = (
                        _subtask_label(current_state.values)
                        if node_name == "execute_tool"
                        else NODE_LABELS.get(node_name, f"Running {node_name}...")
                    )

                    yield _sse_event("step_start", {
                        "node": node_name,
                        "description": label,
                        "timestamp": time.time(),
                    })
                    prev_node = node_name

                    if node_name == "synthesize":
                        is_synthesizing = True

                # Drain any tokens that were queued during this node execution
                while not token_queue.empty():
                    try:
                        token = token_queue.get_nowait()
                        yield _sse_event("token_delta", {"token": token})
                    except asyncio.QueueEmpty:
                        break

                # Extract metrics from node output if available
                metrics = node_output.get("generation_metrics") if isinstance(node_output, dict) else None
                yield _sse_event("step_complete", {
                    "node": node_name,
                    "timestamp": time.time(),
                    "metrics": metrics,
                })

        # Drain remaining tokens after graph completes
        while not token_queue.empty():
            try:
                token = token_queue.get_nowait()
                yield _sse_event("token_delta", {"token": token})
            except asyncio.QueueEmpty:
                break

        # Graph finished — get final state
        final_state = await agent_app.aget_state(config)
        is_paused = bool(final_state.next) and "approval_gate" in (final_state.next or [])

        if is_paused:
            waiting_subtask = final_state.values.get("current_subtask")
            yield _sse_event("approval_required", {
                "task_id": task_id,
                "subtask": _serialize_subtask(waiting_subtask),
                "state": _safe_state(final_state.values),
            })
        else:
            # Emit token_done if response_text was generated
            response_text = final_state.values.get("response_text")
            if response_text:
                yield _sse_event("token_done", {
                    "full_text": response_text,
                    "metrics": final_state.values.get("generation_metrics"),
                })

            # Emit deliverable ready
            yield _sse_event("deliverable_ready", {
                "task_id": task_id,
                "state": _safe_state(final_state.values),
                "metrics": final_state.values.get("generation_metrics"),
            })

        yield _sse_event("done", {
            "task_id": task_id,
            "status": "waiting_approval" if is_paused else "completed",
        })

    except Exception as e:
        log_step(
            task_id=task_id,
            step_type="task_error",
            output_summary=str(e)[:300],
            status="failed",
            user=username,
        )
        yield _sse_event("error", {
            "message": str(e),
            "task_id": task_id,
        })
    finally:
        # Always clean up the callback registration
        unregister_token_callback(task_id)


def _sse_event(event_type: str, data: dict) -> str:
    """Format a Server-Sent Event string."""
    json_data = json.dumps(data, default=str)
    return f"event: {event_type}\ndata: {json_data}\n\n"


def _serialize_subtask(subtask) -> dict:
    """Safely serialize a SubTask (Pydantic model or dict) to dict."""
    if subtask is None:
        return {}
    if isinstance(subtask, dict):
        return subtask
    if hasattr(subtask, "model_dump"):
        return subtask.model_dump()
    return {"description": str(subtask)}


def _safe_state(values: dict) -> dict:
    """Create a JSON-serializable copy of state values."""
    safe = {}
    skip_keys = set()  # No special keys to skip now
    for k, v in values.items():
        if k in skip_keys:
            continue
        try:
            json.dumps(v, default=str)
            safe[k] = v
        except (TypeError, ValueError):
            if hasattr(v, "model_dump"):
                safe[k] = v.model_dump()
            else:
                safe[k] = str(v)
    return safe


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

@app.get("/api/tasks/{task_id}/metrics")
async def get_task_metrics(task_id: str, user: dict = Depends(get_current_user)):
    """Return aggregated generation metrics for a completed task."""
    if agent_app is None:
        raise HTTPException(status_code=503, detail="Agent system initializing")

    config = {"configurable": {"thread_id": task_id}}
    state = await agent_app.aget_state(config)

    if not state or not state.values:
        raise HTTPException(status_code=404, detail="Task not found")

    metrics = state.values.get("generation_metrics")
    if not metrics:
        raise HTTPException(status_code=404, detail="No metrics available for this task")

    return {
        "task_id": task_id,
        "metrics": metrics,
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

    current_state = await agent_app.aget_state(config)
    is_paused = bool(current_state.next)

    return {
        "task_id": task_id,
        "status": "waiting_approval" if is_paused else "completed",
        "state": current_state.values
    }

# ── SSE Streaming Approval Resume ────────────────────────────────────

@app.post("/api/tasks/{task_id}/approve/stream")
async def approve_and_resume_stream(task_id: str, req: ApproveTaskRequest, user: dict = Depends(get_current_user)):
    """Resume after approval with SSE streaming + token streaming."""
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
        async def reject_gen():
            yield _sse_event("done", {"task_id": task_id, "status": "rejected"})
        return StreamingResponse(reject_gen(), media_type="text/event-stream")

    async def event_generator():
        yield _sse_event("step_start", {
            "node": "approval_gate",
            "description": "Operator approval confirmed ✓",
            "timestamp": time.time(),
        })

        # Set up token callback for streaming synthesis
        token_queue: asyncio.Queue = asyncio.Queue()

        async def token_callback(token: str):
            await token_queue.put(token)

        # Register callback so synthesize_deliverable_node can look it up
        register_token_callback(task_id, token_callback)

        try:
            prev_node = None
            async for event in agent_app.astream(None, config=config, stream_mode="updates"):
                for node_name, node_output in event.items():
                    if node_name != prev_node:
                        current_state = await agent_app.aget_state(config)
                        label = _subtask_label(current_state.values) if node_name == "execute_tool" else NODE_LABELS.get(node_name, f"Running {node_name}...")
                        yield _sse_event("step_start", {
                            "node": node_name,
                            "description": label,
                            "timestamp": time.time(),
                        })
                        prev_node = node_name

                    # Drain queued tokens
                    while not token_queue.empty():
                        try:
                            token = token_queue.get_nowait()
                            yield _sse_event("token_delta", {"token": token})
                        except asyncio.QueueEmpty:
                            break

                    metrics = node_output.get("generation_metrics") if isinstance(node_output, dict) else None
                    yield _sse_event("step_complete", {
                        "node": node_name,
                        "timestamp": time.time(),
                        "metrics": metrics,
                    })

            # Drain remaining tokens
            while not token_queue.empty():
                try:
                    token = token_queue.get_nowait()
                    yield _sse_event("token_delta", {"token": token})
                except asyncio.QueueEmpty:
                    break

            final_state = await agent_app.aget_state(config)
            is_paused = bool(final_state.next)

            response_text = final_state.values.get("response_text")
            if response_text:
                yield _sse_event("token_done", {
                    "full_text": response_text,
                    "metrics": final_state.values.get("generation_metrics"),
                })

            yield _sse_event("deliverable_ready", {
                "task_id": task_id,
                "state": _safe_state(final_state.values),
                "metrics": final_state.values.get("generation_metrics"),
            })

            yield _sse_event("done", {
                "task_id": task_id,
                "status": "waiting_approval" if is_paused else "completed",
            })
        except Exception as e:
            yield _sse_event("error", {"message": str(e), "task_id": task_id})
        finally:
            unregister_token_callback(task_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )

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
    """Accept multipart file uploads, store them, and auto-ingest PDFs into LanceDB."""
    saved = []
    for f in files:
        safe_name = os.path.basename(f.filename or "unnamed")
        dest = os.path.join("data", "uploads", safe_name)
        with open(dest, "wb") as out:
            content = await f.read()
            out.write(content)
        saved.append({"filename": safe_name, "path": dest, "size": len(content)})

    # Auto-ingest PDFs into LanceDB for RAG search
    ingested_count = 0
    for s in saved:
        if s["filename"].lower().endswith(".pdf"):
            try:
                from backend.tools.rag_engine import ingest_pdf_file
                chunks = ingest_pdf_file(s["path"], doc_type="uploaded")
                ingested_count += chunks
                s["ingested_chunks"] = chunks
            except Exception as e:
                s["ingest_error"] = str(e)

    log_step(
        task_id="upload",
        step_type="file_upload",
        input_summary=f"Uploaded {len(saved)} file(s): {', '.join(s['filename'] for s in saved)}. Ingested {ingested_count} RAG chunks.",
        user=user["username"],
    )
    return {"uploaded": saved, "rag_chunks_ingested": ingested_count}

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
