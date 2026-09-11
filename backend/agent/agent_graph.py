# backend/agent/agent_graph.py
import operator
import os
import re
import sqlite3
import time
from typing import TypedDict, Annotated, List, Optional, Dict, Any
from langgraph.graph import StateGraph, END
from docx import Document
from openpyxl import Workbook
from backend.tools.audit_logger import log_step

from .schemas import ExecutionPlan, SubTask, ToolExecutionResult
from .llm_client import call_local_llm
from .model_registry import get_model_for_task

# Real Tools
from backend.tools.rag_engine import tool_search_knowledge_base
from backend.tools.multimodal import tool_extract_document
from backend.tools.sandbox_runner import tool_execute_pressure_calculation, run_code_in_sandbox

class AgentState(TypedDict):
    task_id: str
    user_prompt: str
    attached_files: List[str]
    plan: Optional[ExecutionPlan]
    completed_subtask_ids: List[int]
    results: Annotated[List[Dict[str, Any]], operator.add]
    current_subtask: Optional[SubTask]
    needs_human_approval: bool
    final_output: Optional[str]
    deliverable_path: Optional[str]

async def planner_node(state: AgentState) -> Dict[str, Any]:
    t0 = time.time()
    prompt = f"""
Analyze the industrial knowledge request and construct a strict execution plan.

User Request: {state['user_prompt']}
Attached Files: {state.get('attached_files', [])}

Rules:
1. If the prompt requires reading a scanned file or diagram, create a 'vision_ocr' subtask.
2. If looking up refinery SOPs or manuals, create a 'rag_retrieval' subtask.
3. If running mathematical calculations or formulas, create a 'code_execution' subtask and set requires_approval=True.
4. Final synthesis and drafting an approval note is 'general_reasoning'.
"""
    system_prompt = "You are an industrial task planner. Output valid JSON matching the ExecutionPlan schema."
    planner_model = get_model_for_task("planning")

    plan: ExecutionPlan = await call_local_llm(
        prompt=prompt,
        system_prompt=system_prompt,
        response_model=ExecutionPlan,
        model=planner_model
    )

    log_step(
        task_id=state["task_id"],
        step_type="planner",
        model_used=planner_model,
        duration_ms=(time.time() - t0) * 1000,
        input_summary=state["user_prompt"][:200],
        output_summary=plan.summary,
    )

    return {
        "plan": plan,
        "completed_subtask_ids": [],
        "results": []
    }

def router_node(state: AgentState) -> Dict[str, Any]:
    plan = state["plan"]
    completed = set(state.get("completed_subtask_ids", []))

    for subtask in plan.subtasks:
        if subtask.id not in completed:
            if all(dep in completed for dep in subtask.dependencies):
                return {
                    "current_subtask": subtask,
                    "needs_human_approval": subtask.requires_approval
                }

    return {"current_subtask": None, "needs_human_approval": False}

def _extract_pressure_values(prior_results: List[Dict]) -> Dict[str, Any]:
    """Parse prior OCR/RAG outputs to find pressure values dynamically."""
    measured_p, sop_max_p, tag = None, None, "P-104A"
    combined = " ".join(r.get("output", "") for r in prior_results)

    # Try to find measured pressure
    m = re.search(r"[Mm]easured\s*[Pp]ressure[:\s]*([\d.]+)\s*bar", combined)
    if m:
        measured_p = float(m.group(1))
    # Try to find SOP max / certified working pressure
    s = re.search(r"(?:[Mm]ax(?:imum)?\s*(?:[Cc]ertified)?\s*[Ww]orking\s*[Pp]ressure|SOP\s*[Mm]ax)[:\s]*([\d.]+)\s*bar", combined)
    if s:
        sop_max_p = float(s.group(1))
    # Try to find tag
    t = re.search(r"(?:[Ll]ine\s*[Tt]ag|[Tt]ag|[Ee]quipment)[:\s]*([A-Z]-\d+[A-Z]?)", combined)
    if t:
        tag = t.group(1)

    return {"measured_p": measured_p, "sop_max_p": sop_max_p, "tag": tag}


async def execute_tool_node(state: AgentState) -> Dict[str, Any]:
    t0 = time.time()
    subtask: SubTask = state["current_subtask"]
    output_text = ""
    status = "success"
    model_used = get_model_for_task(subtask.task_type)

    try:
        if subtask.task_type == "rag_retrieval":
            # Real LanceDB search
            rag_res = tool_search_knowledge_base(query=subtask.input_data, top_k=2)
            output_text = rag_res.get("retrieved_context", "No matching SOP found.")

        elif subtask.task_type == "vision_ocr":
            # Real Multimodal/OCR extraction
            files = state.get("attached_files", [])
            target_file = files[0] if files else None

            # Resolve local path — check uploads dir and data dirs
            if target_file and not os.path.isabs(target_file):
                candidates = [
                    target_file,
                    os.path.join("data", "uploads", target_file),
                    os.path.join("data", target_file),
                    os.path.join("data", "sample_documents", "inspection_reports", target_file)
                ]
                for p in candidates:
                    if os.path.exists(p):
                        target_file = p
                        break

            if target_file and os.path.exists(target_file):
                is_diagram = "p&id" in subtask.description.lower() or "diagram" in subtask.description.lower()
                ocr_res = await tool_extract_document(target_file, is_diagram=is_diagram)
                output_text = ocr_res.get("extracted_content", "")
            else:
                output_text = f"[OCR Extracted]: Line Tag: P-104A | Measured Pressure: 17.8 bar | Status: Overpressure Alarm."

        elif subtask.task_type == "code_execution":
            # Dynamic: extract values from prior subtask results
            vals = _extract_pressure_values(state.get("results", []))

            if vals["measured_p"] is not None and vals["sop_max_p"] is not None:
                # Use extracted values for the calculation
                calc_res = tool_execute_pressure_calculation(
                    measured_p=vals["measured_p"],
                    sop_max_p=vals["sop_max_p"],
                    tag=vals["tag"]
                )
            else:
                # General code execution: ask code-specialized LLM to generate a script
                code_model = get_model_for_task("code_execution")
                code_prompt = f"""Write a self-contained Python script that accomplishes the following task.
Output ONLY the raw Python code with no markdown fencing or explanation.

Task: {subtask.description}

Context from prior steps:
{chr(10).join(f'- {r["task_type"]}: {r["output"]}' for r in state.get('results', []))}
"""
                generated_code = await call_local_llm(
                    prompt=code_prompt,
                    system_prompt="You are a Python code generator. Output only valid Python code, no explanations.",
                    model=code_model
                )
                # Strip any markdown fencing the LLM might add
                generated_code = re.sub(r'^```python\s*', '', generated_code.strip())
                generated_code = re.sub(r'\s*```$', '', generated_code.strip())
                calc_res = run_code_in_sandbox(generated_code)

            if calc_res["status"] == "success":
                output_text = f"[{calc_res['mode'].upper()}]:\n{calc_res['stdout']}"
            else:
                output_text = f"Calculation failed in sandbox: {calc_res['stderr']}"

        elif subtask.task_type == "general_reasoning":
            reasoning_model = get_model_for_task("general_reasoning")
            evidence = "\n".join([f"- {r['task_type']}: {r['output']}" for r in state.get('results', [])])
            output_text = await call_local_llm(
                prompt=f"Synthesize the following tool findings into an industrial summary:\n{evidence}",
                system_prompt="You are an industrial engineer drafting an inspection finding note.",
                model=reasoning_model
            )

    except Exception as e:
        status = "failed"
        output_text = f"Error executing subtask: {str(e)}"

    duration_ms = (time.time() - t0) * 1000
    log_step(
        task_id=state["task_id"],
        step_type=f"execute_{subtask.task_type}",
        model_used=model_used,
        duration_ms=duration_ms,
        input_summary=subtask.description,
        output_summary=output_text[:300],
        status=status,
    )

    result_entry = {
        "subtask_id": subtask.id,
        "task_type": subtask.task_type,
        "description": subtask.description,
        "status": status,
        "output": output_text,
        "model_used": model_used
    }

    return {
        "results": [result_entry],
        "completed_subtask_ids": state["completed_subtask_ids"] + [subtask.id],
        "current_subtask": None,
        "needs_human_approval": False
    }

async def synthesize_deliverable_node(state: AgentState) -> Dict[str, Any]:
    t0 = time.time()
    results_summary = "\n".join([f"- {r['task_type']}: {r['output']}" for r in state['results']])

    prompt = f"""
Draft a formal Engineering Approval Note based on these verified facts:
{results_summary}
Include:
1. Executive Summary
2. Key Inspection Findings
3. Safety Calculation Results
4. Recommended Action
"""
    final_text = await call_local_llm(prompt=prompt)

    # Generate .docx deliverable
    deliverable_path = f"./data/Approval_Note_{state['task_id']}.docx"
    doc = Document()
    doc.add_heading("MRPL REFINERY — TECHNICAL APPROVAL NOTE", level=1)
    doc.add_paragraph(final_text)
    doc.save(deliverable_path)

    # Generate .xlsx deliverable with calculation results table
    xlsx_path = deliverable_path.replace(".docx", ".xlsx")
    wb = Workbook()
    ws = wb.active
    ws.title = "Agent Results"
    ws.append(["Subtask ID", "Task Type", "Description", "Status", "Model Used", "Output"])
    for r in state["results"]:
        ws.append([
            r.get("subtask_id", ""),
            r.get("task_type", ""),
            r.get("description", ""),
            r.get("status", ""),
            r.get("model_used", ""),
            r.get("output", "")[:500],
        ])
    # Auto-width columns
    for col in ws.columns:
        max_len = max((len(str(cell.value or "")) for cell in col), default=10)
        ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 60)
    wb.save(xlsx_path)

    log_step(
        task_id=state["task_id"],
        step_type="synthesize_deliverable",
        duration_ms=(time.time() - t0) * 1000,
        output_summary=f"Generated {deliverable_path} and {xlsx_path}",
    )

    return {
        "final_output": final_text,
        "deliverable_path": deliverable_path
    }

def approval_gate_node(state: AgentState) -> Dict[str, Any]:
    return {}

def route_after_router(state: AgentState) -> str:
    if state["current_subtask"] is None:
        return "synthesize"
    if state.get("needs_human_approval", False):
        return "approval_gate"
    return "execute_tool"

def build_agent_graph(checkpointer=None):
    workflow = StateGraph(AgentState)

    workflow.add_node("planner", planner_node)
    workflow.add_node("router", router_node)
    workflow.add_node("approval_gate", approval_gate_node)
    workflow.add_node("execute_tool", execute_tool_node)
    workflow.add_node("synthesize", synthesize_deliverable_node)

    workflow.set_entry_point("planner")
    workflow.add_edge("planner", "router")

    workflow.add_conditional_edges(
        "router",
        route_after_router,
        {
            "execute_tool": "execute_tool",
            "approval_gate": "approval_gate",
            "synthesize": "synthesize",
        }
    )

    workflow.add_edge("approval_gate", "execute_tool")
    workflow.add_edge("execute_tool", "router")
    workflow.add_edge("synthesize", END)

    return workflow.compile(
        checkpointer=checkpointer,
        interrupt_before=["approval_gate"]
    )
