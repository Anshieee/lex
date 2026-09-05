# backend/main.py
import sqlite3
import uuid
import os
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
from langgraph.checkpoint.sqlite import SqliteSaver

from agent.agent_graph import build_agent_graph, AgentState

app = FastAPI(title="Sovereign On-Premise Industrial AI Workbench")

# Local loopback CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Persistent SQLite WAL Checkpointer
os.makedirs("data", exist_ok=True)
db_conn = sqlite3.connect("data/workbench_state.db", check_same_thread=False)
db_conn.execute("PRAGMA journal_mode=WAL;")
checkpointer = SqliteSaver(db_conn)

agent_app = build_agent_graph(checkpointer)

class SubmitTaskRequest(BaseModel):
    prompt: str
    files: Optional[List[str]] = []

class ApproveTaskRequest(BaseModel):
    task_id: str
    approved: bool

@app.post("/api/tasks/submit")
async def submit_task(req: SubmitTaskRequest):
    """Starts a new agent task and executes until completed or paused for approval."""
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

    # Run the graph until completion or interrupt
    result = await agent_app.ainvoke(initial_state, config=config)
    
    # Check if interrupted for approval
    state = agent_app.get_state(config)
    is_paused = len(state.next) > 0 and state.values.get("needs_human_approval", False)

    return {
        "task_id": task_id,
        "status": "waiting_approval" if is_paused else "completed",
        "state": state.values
    }

@app.get("/api/tasks/{task_id}/status")
async def get_task_status(task_id: str):
    """Fetches the current state, logs, and plan of the agent."""
    config = {"configurable": {"thread_id": task_id}}
    state = agent_app.get_state(config)
    
    if not state or not state.values:
        raise HTTPException(status_code=404, detail="Task not found")

    is_paused = len(state.next) > 0
    return {
        "task_id": task_id,
        "is_paused": is_paused,
        "next_node": state.next,
        "values": state.values
    }

@app.post("/api/tasks/{task_id}/approve")
async def approve_and_resume(task_id: str, req: ApproveTaskRequest):
    """Human-in-the-loop approval endpoint: Resumes graph after user approves."""
    config = {"configurable": {"thread_id": task_id}}
    state = agent_app.get_state(config)

    if not state or len(state.next) == 0:
        raise HTTPException(status_code=400, detail="Task is not waiting for approval")

    if not req.approved:
        return {"status": "rejected", "message": "Action cancelled by operator"}

    # Resume graph execution
    result = await agent_app.ainvoke(None, config=config)
    current_state = agent_app.get_state(config)

    return {
        "task_id": task_id,
        "status": "completed" if len(current_state.next) == 0 else "waiting_approval",
        "state": current_state.values
    }

@app.get("/api/tasks/{task_id}/download")
async def download_deliverable(task_id: str):
    """Serves the generated .docx Approval Note."""
    config = {"configurable": {"thread_id": task_id}}
    state = agent_app.get_state(config)
    
    file_path = state.values.get("deliverable_path")
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Deliverable not generated yet")

    return FileResponse(
        file_path, 
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=os.path.basename(file_path)
    )
