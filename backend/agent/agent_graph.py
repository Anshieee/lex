# backend/agent/agent_graph.py
import operator
from typing import TypedDict, Annotated, List, Optional, Dict, Any
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver
import sqlite3

from .schemas import ExecutionPlan, SubTask, ToolExecutionResult
from .llm_client import call_local_llm

# ==========================================
# 1. State Definition
# ==========================================
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

# ==========================================
# 2. Node Implementations
# ==========================================
async def planner_node(state: AgentState) -> Dict[str, Any]:
    """Decomposes user intent into a dependency graph of subtasks."""
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
        response_schema=ExecutionPlan
    )
    
    return {
        "plan": plan,
        "completed_subtask_ids": [],
        "results": []
    }

def router_node(state: AgentState) -> Dict[str, Any]:
    """Finds the next executable subtask whose dependencies are satisfied."""
    plan = state["plan"]
    completed = set(state.get("completed_subtask_ids", []))

    for subtask in plan.subtasks:
        if subtask.id not in completed:
            # Check if all dependencies are satisfied
            if all(dep in completed for dep in subtask.dependencies):
                return {
                    "current_subtask": subtask,
                    "needs_human_approval": subtask.requires_approval
                }

    # All subtasks done
    return {"current_subtask": None, "needs_human_approval": False}

async def execute_tool_node(state: AgentState) -> Dict[str, Any]:
    """Executes the tool or specialist model for the active subtask."""
    subtask: SubTask = state["current_subtask"]
    
    output_text = ""
    status = "success"

    try:
        if subtask.task_type == "rag_retrieval":
            # Mock or import tool_search_knowledge_base from Role 3
            output_text = f"[RAG Result for '{subtask.input_data}']: Refinery Standard SOP-402: Safe Operating Pressure Limit = 15.2 bar."
        
        elif subtask.task_type == "vision_ocr":
            # Mock or import tool_extract_document from Role 3
            output_text = f"[OCR Extracted]: Line Tag: P-104A | Measured Pressure: 17.8 bar | Status: Overpressure Alarm."
        
        elif subtask.task_type == "code_execution":
            # Call sandboxed code execution (from Role 2)
            output_text = f"[Sandbox Execution Result]: Calculation verified. Delta P = +2.6 bar (Exceeds tolerance limit by 17.1%)."
            
        elif subtask.task_type == "general_reasoning":
            output_text = await call_local_llm(
                prompt=f"Synthesize the following tool findings into an industrial summary:\n{state.get('results', [])}",
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
    """Synthesizes final answer and triggers real .docx/.xlsx deliverable creation."""
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
    
    # Save a real word document (Deliverable)
    deliverable_path = f"./data/Approval_Note_{state['task_id']}.docx"
    from docx import Document
    doc = Document()
    doc.add_heading("MRPL REFINERY — TECHNICAL APPROVAL NOTE", level=1)
    doc.add_paragraph(final_text)
    doc.save(deliverable_path)

    return {
        "final_output": final_text,
        "deliverable_path": deliverable_path
    }

# ==========================================
# 3. Conditional Edges & Routing Logic
# ==========================================
def check_next_step(state: AgentState) -> str:
    if state["current_subtask"] is None:
        return "synthesize"
    return "execute_tool"

# ==========================================
# 4. Graph Construction
# ==========================================
def build_agent_graph(checkpointer: SqliteSaver):
    workflow = StateGraph(AgentState)

    workflow.add_node("planner", planner_node)
    workflow.add_node("router", router_node)
    workflow.add_node("execute_tool", execute_tool_node)
    workflow.add_node("synthesize", synthesize_deliverable_node)

    workflow.set_entry_point("planner")
    workflow.add_edge("planner", "router")
    
    workflow.add_conditional_edges(
        "router",
        check_next_step,
        {
            "execute_tool": "execute_tool",
            "synthesize": "synthesize"
        }
    )
    
    workflow.add_edge("execute_tool", "router")
    workflow.add_edge("synthesize", END)

    # Human Approval Gate: Interrupt BEFORE executing any subtask flagged with requires_approval=True
    return workflow.compile(
        checkpointer=checkpointer,
        interrupt_before=["execute_tool"]
    )
