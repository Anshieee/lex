# backend/main.py
import os
import uuid
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from backend.agent.agent_graph import build_agent_graph

agent_app = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent_app
    os.makedirs("data", exist_ok=True)
    
    # Initialize table schema and create checkpointer
    async with AsyncSqliteSaver.from_conn_string("data/workbench_state.db") as checkpointer:
        await checkpointer.setup()
        agent_app = build_agent_graph(checkpointer)
        yield

app = FastAPI(title="Sovereign AI Workbench", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
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

@app.post("/api/tasks/submit")
async def submit_task(req: SubmitTaskRequest):
    if agent_app is None:
        raise HTTPException(status_code=503, detail="Agent system initializing")

    task_id = str(uuid.uuid4())[:8]
    config = {"configurable": {"thread_id": task_id}}

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
    await agent_app.ainvoke(initial_state, config=config)
    state = await agent_app.aget_state(config)
    is_paused = len(state.next) > 0 and "approval_gate" in state.next
    return {
    "task_id": task_id,
    "status": "waiting_approval" if is_paused else "completed",
    "state": state.values
    }

@app.get("/api/tasks/{task_id}/status")
async def get_task_status(task_id: str):
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
async def approve_and_resume(task_id: str, req: ApproveTaskRequest):
    if agent_app is None:
        raise HTTPException(status_code=503, detail="Agent system initializing")

    config = {"configurable": {"thread_id": task_id}}
    state = await agent_app.aget_state(config)

    if not state or len(state.next) == 0:
        raise HTTPException(status_code=400, detail="Task is not waiting for approval")

    if not req.approved:
        return {"status": "rejected", "message": "Subtask rejected by operator."}

    # Resume graph execution and await full run to completion/interrupt
    await agent_app.ainvoke(None, config=config)
    
    # Reload fresh checkpoint from SQLite
    current_state = await agent_app.aget_state(config)
    is_paused = bool(current_state.next)

    return {
        "task_id": task_id,
        "status": "waiting_approval" if is_paused else "completed",
        "state": current_state.values
    }

@app.get("/api/tasks/{task_id}/download")
async def download_deliverable(task_id: str):
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
