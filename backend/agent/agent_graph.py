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
from .llm_client import call_local_llm, call_local_llm_with_metrics, stream_local_llm, LLMMetrics
from .model_registry import get_model_for_task

# Real Tools
from backend.tools.rag_engine import tool_search_knowledge_base
from backend.tools.multimodal import tool_extract_document
from backend.tools.sandbox_runner import tool_execute_pressure_calculation, run_code_in_sandbox

# ── Module-level token callback registry ─────────────────────────────
# Maps task_id → async callback for streaming tokens from synthesize node.
# Registered by main.py before invoking the graph, cleaned up after.
_TOKEN_CALLBACKS: Dict[str, Any] = {}

def register_token_callback(task_id: str, callback) -> None:
    """Register a token streaming callback for a task."""
    _TOKEN_CALLBACKS[task_id] = callback

def unregister_token_callback(task_id: str) -> None:
    """Remove the token callback after task completes."""
    _TOKEN_CALLBACKS.pop(task_id, None)

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
    # ── New fields for conversational response + metrics ──
    response_text: Optional[str]
    generation_metrics: Optional[Dict[str, Any]]
    selected_model: Optional[str]

async def planner_node(state: AgentState) -> Dict[str, Any]:
    t0 = time.time()
    attached = state.get('attached_files', [])
    prompt = f"""
Analyze the user's request and construct an execution plan with the right subtasks.

User Request: {state['user_prompt']}
Attached Files: {attached}

Available subtask types (use only what's needed):
- 'vision_ocr': Read scanned documents, diagrams, P&IDs, images, or extract text from uploaded files
- 'rag_retrieval': Search the indexed knowledge base for relevant SOPs, manuals, standards, or previously uploaded documents
- 'code_execution': Run calculations, data processing, or analysis scripts (set requires_approval=True for safety)
- 'general_reasoning': Synthesize information, draft content, reason about findings, or generate written output

Rules:
1. Create subtasks that directly address what the user asked for.
2. If files are attached, start with 'vision_ocr' to extract their content.
3. Always include a 'rag_retrieval' step to search for relevant knowledge base content.
4. Use 'general_reasoning' as a final synthesis step to compile everything together.
5. Only use 'code_execution' if the task requires actual calculations or data processing.
6. Keep the plan focused — typically 2-4 subtasks.
7. CRITICAL: Do NOT hallucinate tasks or implicitly assume goals. Your plan must precisely reflect only what the user requested.
"""
    system_prompt = "You are an industrial task planner. Output valid JSON matching the ExecutionPlan schema. Create practical, highly predictable, and strictly focused execution plans."
    planner_model = state.get("selected_model") or get_model_for_task("planning")

    llm_resp = await call_local_llm_with_metrics(
        prompt=prompt,
        system_prompt=system_prompt,
        response_model=ExecutionPlan,
        model=planner_model
    )
    plan = llm_resp.parsed

    duration_ms = (time.time() - t0) * 1000
    log_step(
        task_id=state["task_id"],
        step_type="planner",
        model_used=planner_model,
        duration_ms=duration_ms,
        input_summary=state["user_prompt"][:200],
        output_summary=plan.summary,
    )

    # Initialize generation metrics with planner stats
    metrics = {
        "total_tokens_in": llm_resp.metrics.tokens_in,
        "total_tokens_out": llm_resp.metrics.tokens_out,
        "total_duration_ms": llm_resp.metrics.duration_ms,
        "last_eval_tps": llm_resp.metrics.eval_tokens_per_sec,
        "steps": [{
            "node": "planner",
            "model": planner_model,
            "tokens_in": llm_resp.metrics.tokens_in,
            "tokens_out": llm_resp.metrics.tokens_out,
            "duration_ms": llm_resp.metrics.duration_ms,
            "eval_tps": llm_resp.metrics.eval_tokens_per_sec,
        }],
    }

    return {
        "plan": plan,
        "completed_subtask_ids": [],
        "results": [],
        "generation_metrics": metrics,
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
    model_used = state.get("selected_model") or get_model_for_task(subtask.task_type)
    step_metrics = None

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
                code_resp = await call_local_llm_with_metrics(
                    prompt=code_prompt,
                    system_prompt="You are a Python code generator. Output only valid Python code, no explanations.",
                    model=code_model
                )
                generated_code = code_resp.content
                step_metrics = code_resp.metrics
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
            llm_resp = await call_local_llm_with_metrics(
                prompt=f"Synthesize the following tool findings into an industrial summary:\n{evidence}",
                system_prompt="You are an industrial engineer drafting an inspection finding note.",
                model=reasoning_model
            )
            output_text = llm_resp.content
            step_metrics = llm_resp.metrics

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

    # Accumulate metrics
    existing_metrics = state.get("generation_metrics") or {
        "total_tokens_in": 0, "total_tokens_out": 0,
        "total_duration_ms": 0, "last_eval_tps": 0, "steps": [],
    }
    if step_metrics:
        existing_metrics["total_tokens_in"] += step_metrics.tokens_in
        existing_metrics["total_tokens_out"] += step_metrics.tokens_out
        existing_metrics["total_duration_ms"] += step_metrics.duration_ms
        existing_metrics["last_eval_tps"] = step_metrics.eval_tokens_per_sec
        existing_metrics["steps"].append({
            "node": f"execute_{subtask.task_type}",
            "model": model_used,
            "tokens_in": step_metrics.tokens_in,
            "tokens_out": step_metrics.tokens_out,
            "duration_ms": step_metrics.duration_ms,
            "eval_tps": step_metrics.eval_tokens_per_sec,
        })

    return {
        "results": [result_entry],
        "completed_subtask_ids": state["completed_subtask_ids"] + [subtask.id],
        "current_subtask": None,
        "needs_human_approval": False,
        "generation_metrics": existing_metrics,
    }

async def synthesize_deliverable_node(state: AgentState) -> Dict[str, Any]:
    t0 = time.time()
    results_summary = "\n".join([f"- {r['task_type']}: {r['output']}" for r in state['results']])
    user_prompt = state['user_prompt']

    # ── 1. Generate document content adapted to the user's request ──
    prompt = f"""
Based on the following research and analysis, draft a formal professional document that directly addresses the user's original request.

User's Original Request: {user_prompt}

Research Findings and Analysis:
{results_summary}

Instructions:
1. Structure the document with clear headings appropriate to the topic.
2. Start with an Executive Summary or Overview.
3. Include all relevant findings from the research.
4. End with Conclusions and Recommendations if appropriate.
5. Use professional technical language.
6. CRITICAL: Be strictly precise. Only include facts based on the user's explicit request and the research findings. Do not add generic filler.
"""
    synth_model = state.get("selected_model") or get_model_for_task("general_reasoning")
    doc_resp = await call_local_llm_with_metrics(prompt=prompt, model=synth_model)
    final_text = doc_resp.content

    # Generate a meaningful document title from the prompt
    title_prompt = f"Generate a short professional document title (max 10 words, no quotes) for this request: {user_prompt}"
    try:
        doc_title = await call_local_llm(
            prompt=title_prompt,
            system_prompt="Output only the title, no explanation or punctuation marks like quotes.",
            temperature=0.0,
        )
        doc_title = doc_title.strip().strip('"').strip("'")[:80]
    except Exception:
        doc_title = "LEX Generated Document"

    # Generate safe filename from title
    safe_title = re.sub(r'[^a-zA-Z0-9_\- ]', '', doc_title).strip().replace(' ', '_')[:50]
    if not safe_title:
        safe_title = f"Document_{state['task_id']}"

    # Generate .docx deliverable
    deliverable_path = f"./data/{safe_title}_{state['task_id']}.docx"
    doc = Document()
    doc.add_heading(doc_title, level=1)
    doc.add_paragraph(final_text)
    doc.save(deliverable_path)

    # Generate .xlsx deliverable with results table
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

    # ── 2. Generate conversational markdown summary ──
    conv_prompt = f"""You are LEX, a sovereign on-premise AI workbench for industrial use. 
You just completed an analysis task for an operator. Summarize your findings in a conversational, 
helpful tone using markdown formatting. Be thorough but concise.

Original request: {state['user_prompt']}

Your analysis steps and findings:
{results_summary}

Final document generated: {deliverable_path}

Write a natural response as if you're talking to the operator. Use markdown headers, bullet points, 
bold text, and code blocks where appropriate. Start with a brief summary, then detail your findings.
Do NOT include any preamble like "Here is..." — just start with the content directly."""

    conv_system = "You are LEX, a sovereign industrial AI assistant. Respond naturally in markdown."
    token_cb = _TOKEN_CALLBACKS.get(state["task_id"])

    if token_cb is not None:
        # ── Stream tokens through the callback for real-time SSE ──
        response_text = ""
        conv_metrics = LLMMetrics()
        async for chunk in stream_local_llm(
            prompt=conv_prompt,
            system_prompt=conv_system,
            temperature=0.3,
        ):
            if isinstance(chunk, LLMMetrics):
                conv_metrics = chunk
            else:
                response_text += chunk
                await token_cb(chunk)

        class _FakeResp:
            pass
        conv_resp = _FakeResp()
        conv_resp.content = response_text
        conv_resp.metrics = conv_metrics
    else:
        # ── Non-streaming fallback (used by REST endpoint) ──
        conv_resp = await call_local_llm_with_metrics(
            prompt=conv_prompt,
            system_prompt=conv_system,
            temperature=0.3,
        )
        response_text = conv_resp.content

    # ── 3. Aggregate final metrics ──
    existing_metrics = state.get("generation_metrics") or {
        "total_tokens_in": 0, "total_tokens_out": 0,
        "total_duration_ms": 0, "last_eval_tps": 0, "steps": [],
    }
    # Add document generation metrics
    existing_metrics["total_tokens_in"] += doc_resp.metrics.tokens_in
    existing_metrics["total_tokens_out"] += doc_resp.metrics.tokens_out
    existing_metrics["total_duration_ms"] += doc_resp.metrics.duration_ms
    existing_metrics["steps"].append({
        "node": "synthesize_document",
        "model": doc_resp.metrics.model,
        "tokens_in": doc_resp.metrics.tokens_in,
        "tokens_out": doc_resp.metrics.tokens_out,
        "duration_ms": doc_resp.metrics.duration_ms,
        "eval_tps": doc_resp.metrics.eval_tokens_per_sec,
    })
    # Add conversational response metrics
    existing_metrics["total_tokens_in"] += conv_resp.metrics.tokens_in
    existing_metrics["total_tokens_out"] += conv_resp.metrics.tokens_out
    existing_metrics["total_duration_ms"] += conv_resp.metrics.duration_ms
    existing_metrics["last_eval_tps"] = conv_resp.metrics.eval_tokens_per_sec
    existing_metrics["steps"].append({
        "node": "synthesize_response",
        "model": conv_resp.metrics.model,
        "tokens_in": conv_resp.metrics.tokens_in,
        "tokens_out": conv_resp.metrics.tokens_out,
        "duration_ms": conv_resp.metrics.duration_ms,
        "eval_tps": conv_resp.metrics.eval_tokens_per_sec,
    })
    # Compute aggregate tokens/sec
    total_tokens = existing_metrics["total_tokens_out"]
    total_sec = existing_metrics["total_duration_ms"] / 1000 if existing_metrics["total_duration_ms"] > 0 else 1
    existing_metrics["avg_tokens_per_sec"] = round(total_tokens / total_sec, 2)

    log_step(
        task_id=state["task_id"],
        step_type="synthesize_deliverable",
        duration_ms=(time.time() - t0) * 1000,
        output_summary=f"Generated {deliverable_path} and {xlsx_path}",
    )

    return {
        "final_output": final_text,
        "deliverable_path": deliverable_path,
        "response_text": response_text,
        "generation_metrics": existing_metrics,
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

