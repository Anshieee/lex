# Independent Review Report — LEX Sovereign AI Workbench

**Reviewer:** rev1-r2@product-team (Independent Reviewer)  
**Date:** 2026-09-27  
**Review Scope:** Full codebase audit against PROJECT_BRIEFING.md claims and implementation_plan.md requirements

---

## Executive Summary

The LEX project is a **genuinely working hackathon prototype** with strong architecture (LangGraph + FastAPI + React) and verified end-to-end execution (audit log proves real agent runs). However, **critical gaps exist between documented claims and actual implementation** that undermine the "sovereign" and "production-ready" narrative. Three categories of findings:

| Category | Count | Severity |
|----------|-------|----------|
| **Critical** (breaks core claims, security, or correctness) | 4 | P0 |
| **Major** (significant functional gaps) | 5 | P1 |
| **Moderate** (code quality, maintainability, UX) | 7 | P2 |

**Verdict:** Not ready for production or judged demo without P0/P1 fixes. The sovereignty proof has false positives, OCR fabricates data, approval flow has race conditions, and rejection is silently broken.

---

## Critical Findings (P0)

### 1. OCR Pipeline Fabricates Evidence — "Sovereign Facts" Are Hardcoded
**Files:** `backend/agent/agent_graph.py:139-148`, `backend/tools/multimodal.py:67-71`  
**Evidence:** Audit log shows `execute_vision_ocr` completing in **0.1 ms** with identical output across 8+ tasks:
```
"[OCR Extracted]: Line Tag: P-104A | Measured Pressure: 17.8 bar | Status: Overpressure Alarm."
```

**Root cause:** In `multimodal.py`, scanned PDFs (<50 chars embedded text) return a **placeholder string** instead of rendering pages to images for Tesseract/VLM. The comment admits: *"For multi-page PDF images in prod, render page to image first."* No `pymupdf`/`pdf2image` in venv.

**In `agent_graph.py`:** If the file path doesn't resolve, the same hardcoded string is used as fallback.

**Consequence:** The demo works **without ever reading the actual scan**. Judges can verify by deleting `data/uploads/boiler_scan.pdf` — the output is identical. This directly contradicts "we don't trust the LLM with facts" and "multimodal understanding" claims.

---

### 2. Network Sovereignty Monitor Has False Positives (Non-Linux = "Sovereign")
**File:** `backend/tools/network_monitor.py:86-93`  
**Code:**
```python
except FileNotFoundError:
    # Not on Linux (e.g. macOS) — fall back to ss
    pass
return connections  # Empty list → sovereign: true
```

**Consequence:** On macOS/Windows (common judge environments), `/proc/net/tcp` doesn't exist → `get_connections()` returns `[]` → `outbound_connections == 0` → **`sovereign: true`**. The green shield is a lie on non-Linux.

**Missing coverage:** IPv6 (`/proc/net/tcp6`), UDP — an attacker could exfiltrate via UDP and the monitor would show "0 outbound."

---

### 3. Approval Race Condition — 9 Duplicate Approvals in 10 Seconds
**Files:** `frontend/src/lib/agent/useAgentStore.ts:249-280`, `backend/main.py:128-170`  
**Evidence:** Audit log task `465031a6` — **9 identical "Approved by operator" entries** between 19:09:31.694 and 19:09:41.518.

**Frontend:** `approve()` does optimistic UI update + background `fetch()` but the button isn't disabled during request (only `approvalProcessingRef` guard added *after* QA report).

**Backend:** `approve_and_resume` **has idempotency check** (lines 139-152) but it only checks `if "approval_gate" not in state.next` — which doesn't prevent re-execution if the graph hasn't advanced past the gate yet.

**Impact:** Wasted LLM compute, audit log pollution, potential state corruption.

---

### 4. Rejection Is a Silent No-Op — Backend Never Notified
**File:** `frontend/src/lib/agent/useAgentStore.ts:363-377`  
**Code:** `reject()` callback **only updates local UI state** — no `fetch()` to `/api/tasks/{id}/approve` with `approved: false`.

**Audit log confirms:** `grep -i "reject" data/audit_log.jsonl` → **zero results**.

**Backend behavior:** Graph stays paused at `approval_gate` checkpoint forever. Operator thinks they rejected; task is actually stuck.

**Consequence:** Critical HITL feature is broken. No cancellation/resume path exists in the graph.

---

## Major Findings (P1)

### 5. Silent Sandbox Fallback — Operators Don't Know Code Runs Locally
**File:** `backend/tools/sandbox_runner.py:23-47`  
**Code:** gVisor Docker attempt prints to stdout on failure:
```python
print(f"[Sandbox Notice] gVisor Docker run exited with code {proc.returncode}. Falling back to local runner.")
```

**Returned dict has** `"mode": "local_subprocess_fallback"` but **this is never surfaced** to agent or frontend.

**Frontend trace** shows `"model": "qwen2.5:7b → sandbox"` regardless of actual execution mode.

**Consequence:** Sovereignty claim ("isolated sandbox") is violated silently. In demo environment (no gVisor), all code runs as backend user with **no filesystem isolation**.

---

### 6. First-Run HuggingFace Download = Egress on "Air-Gapped" System
**File:** `backend/tools/rag_engine.py:23-33`  
**Code:**
```python
try:
    embed_model = SentenceTransformer(..., model_kwargs={"local_files_only": True})
except Exception:
    embed_model = SentenceTransformer(...)  # Downloads ~33MB from HF
```

**Consequence:** First boot downloads BGE-small from HuggingFace — **network egress on an "air-gapped" system**. The network monitor would flag this (if running on Linux), contradicting the zero-egress pitch.

---

### 7. No RAG Ingestion API — Knowledge Base Is Static
**Files:** `backend/tools/rag_engine.py` has `ingest_pdf_file()` but **no `/api/ingest` endpoint** in `main.py` (despite `implementation_plan.md` requiring it).

**Frontend:** `ingestDocument()` in `useAgentStore.ts:472` only increments a hardcoded counter (`kbDocCount`), **no API call**.

**Consequence:** Judges cannot ingest new documents during demo. The "5 models" drawer shows a fake doc count.

---

### 8. Prompt Injection Surface — User Prompt Never Sanitized
**File:** `backend/agent/agent_graph.py:19` uses raw `state['user_prompt']` in planner without sanitization.

**Sanitizer exists** (`backend/tools/sanitizer.py`) but only applied to **OCR output**, not user input.

**Consequence:** Direct prompt injection via chat input bypasses all defenses.

---

### 9. Hardcoded Fallback File Masks Missing Uploads
**File:** `frontend/src/lib/agent/useAgentStore.ts:163`:
```typescript
files: uploadedFilenames.length > 0 ? uploadedFilenames : ["boiler_scan.pdf"]
```

**Backend** (`agent_graph.py:139-148`) falls back to mock OCR data if file not found.

**Consequence:** Leaky abstraction — demo works without uploads, confusing behavior when test file missing, silent mock substitution.

---

## Moderate Findings (P2)

| # | Issue | File/Location | Impact |
|---|-------|---------------|--------|
| 10 | Model label ternary bug | `useAgentStore.ts:316` — `a \|\| b ? c : d` precedence shows wrong model for every step | Misleading trace UI |
| 11 | Network poll was 3s (now 15s) | `useAgentStore.ts:79` — excessive for sovereignty monitor | Unnecessary load |
| 12 | Model registry hardcoded fallback | `model_registry.py` has inline defaults; `infra/models.yaml` not in repo | Config drift |
| 13 | No health check endpoint | `main.py` had none (added recently per QA) | Ops visibility |
| 14 | Upload validation missing | `main.py:200-218` — no size limit, type validation, collision handling | Security/DoS risk |
| 15 | Dead code committed | `file_tools.py`, `ToolExecutionResult` schema, `mockEngine.ts`, `.bak` files | Repo hygiene |
| 16 | 31,091 `node_modules` tracked in git | `.gitignore` exists but files committed before rule | Repo ~400MB+, submission risk |
| 17 | Relative `data/` paths CWD-dependent | Both `data/` and `backend/data/` exist with overlapping artifacts | Unreliable in deployment |

---

## Positive Observations (Verified Working)

| Area | Evidence |
|------|----------|
| **LangGraph pipeline** | Structured planning, DAG routing, `interrupt_before`, SQLite checkpointing — all correct |
| **Auth system** | JWT + bcrypt + SQLite, preset users, role-based deps — clean |
| **Audit logging** | Complete JSONL with task/step/model/duration/user — best evidence of real runs |
| **RAG (post-ingest)** | LanceDB + BGE-small on CPU, source-cited retrieval — solid for demo |
| **Deliverable generation** | Real `.docx` + `.xlsx` via python-docx/openpyxl — verified in `data/` |
| **Frontend polish** | Dark industrial theme, galaxy animation, model drawer, approval card, dual download |

---

## Recommendations (Prioritized)

### P0 — Must Fix Before Demo/Judging
1. **Make OCR real for demo path:** Add `pymupdf`/`pdf2image` → render PDF pages → Tesseract/VLM. Remove/gate hardcoded fallback.
2. **Fix network monitor:** Add `tcp6`/`udp` support; fail loudly (not "sovereign") on non-Linux.
3. **Fix approval idempotency:** Backend — check `state.values.get("needs_human_approval")` + dedup key; Frontend — disable button during request.
4. **Implement rejection backend call:** Add `fetch(..., {approved: false})` to `reject()`; update graph to handle rejection (cancel or mark aborted).

### P1 — Should Fix
5. **Surface sandbox mode:** Return `mode` in result; display in frontend trace.
6. **Add RAG ingestion API:** `POST /api/ingest` calling `ingest_pdf_file()`.
7. **Sanitize user prompts:** Apply `sanitize_untrusted_text()` to `user_prompt` in planner.
8. **Remove hardcoded fallback file:** Require explicit upload or show clear error.

### P2 — Polish
9. Fix model label ternary; remove dead code (`.bak`, `mockEngine.ts`, `file_tools.py`); untrack `node_modules`; pin `requirements.txt`; add health check; validate uploads; reconcile briefing vs code (model tags, subtask counts).

---

## Verification Evidence

All findings confirmed via:
- **Source code inspection** (file:line references above)
- **Audit log analysis** (`data/audit_log.jsonl` — 100+ entries across 8 task runs)
- **Git status** (committed `node_modules`, dead files, unstaged changes)
- **Live environment checks** (Ollama models, venv, directory structure)

---

## Sign-off

**Independent Review Verdict:** The system demonstrates **genuine agentic capability** but has **critical integrity gaps** in its core sovereignty and correctness claims. P0 fixes are mandatory before any judged demonstration or production consideration.

**Review Methodology:** Evidence-based, file-referenced, audit-log-correlated. No findings manufactured — clean review would report zero critical issues.

---
*Review conducted per team culture: "Every claim backed by evidence. Every finding backed by a file:line reference or command output."*
