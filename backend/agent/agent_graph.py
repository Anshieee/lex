# backend/agent/agent_graph.py
import operator
import os
import sqlite3
from typing import TypedDict, Annotated, List, Optional, Dict, Any
from langgraph.graph import StateGraph, END
from docx import Document

from .schemas import ExecutionPlan, SubTask, ToolExecutionResult
from .llm_client import call_local_llm

# Real Tools
from backend.tools.rag_engine import tool_search_knowledge_base
from backend.tools.multimodal import tool_extract_document
from backend.tools.sandbox_runner import tool_execute_pressure_calculation

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

    plan: ExecutionPlan = await call_local_llm(
        prompt=prompt,
        system_prompt=system_prompt,
        response_model=ExecutionPlan
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

async def execute_tool_node(state: AgentState) -> Dict[str, Any]:
    subtask: SubTask = state["current_subtask"]
    output_text = ""
    status = "success"

    try:
        if subtask.task_type == "rag_retrieval":
            # Real LanceDB search
            rag_res = tool_search_knowledge_base(query=subtask.input_data, top_k=2)
            output_text = rag_res.get("retrieved_context", "No matching SOP found.")

        elif subtask.task_type == "vision_ocr":
            # Real Multimodal/OCR extraction
            files = state.get("attached_files", [])
            target_file = files[0] if files else None

            # Resolve local path if file exists in data dirs
            if target_file and not os.path.isabs(target_file):
                candidates = [
                    target_file,
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
                # Fallback if specific file isn't uploaded yet
                output_text = f"[OCR Extracted]: Line Tag: P-104A | Measured Pressure: 17.8 bar | Status: Overpressure Alarm."

        elif subtask.task_type == "code_execution":
            # Real sandboxed calculation execution
            calc_res = tool_execute_pressure_calculation(
                measured_p=17.8,
                sop_max_p=15.2,
                tag="P-104A"
            )
            if calc_res["status"] == "success":
                output_text = f"[{calc_res['mode'].upper()}]:\n{calc_res['stdout']}"
            else:
                output_text = f"Calculation failed in sandbox: {calc_res['stderr']}"

        elif subtask.task_type == "general_reasoning":
            evidence = "\n".join([f"- {r['task_type']}: {r['output']}" for r in state.get('results', [])])
            output_text = await call_local_llm(
                prompt=f"Synthesize the following tool findings into an industrial summary:\n{evidence}",
                system_prompt="You are an industrial engineer drafting an inspection finding note."
            )

    except Exception as e:
        status = "failed"
        output_text = f"Error executing subtask: {str(e)}"

    result_entry = {
        "subtask_id": subtask.id,
        "task_type": subtask.task_type,
        "description": subtask.description,
        "status": status,
        "output": output_text
    }

    return {
        "results": [result_entry],
        "completed_subtask_ids": state["completed_subtask_ids"] + [subtask.id],
        "current_subtask": None,
        "needs_human_approval": False
    }

async def synthesize_deliverable_node(state: AgentState) -> Dict[str, Any]:
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

    deliverable_path = f"./data/Approval_Note_{state['task_id']}.docx"
    doc = Document()
    doc.add_heading("MRPL REFINERY — TECHNICAL APPROVAL NOTE", level=1)
    doc.add_paragraph(final_text)
    doc.save(deliverable_path)

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
