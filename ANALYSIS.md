# LEX — Project Analysis

> Thorough code-level analysis of the LEX "Sovereign On-Premise Agentic AI Workbench"
> (Smart India Hackathon 2024 · PS #26117). Generated from a full read of the backend,
> frontend, data artifacts, git history, and live environment checks.

---

## 1. What This Project Is

**LEX (Living EXpert)** is a self-hosted, air-gapped AI workbench for confidential
industrial knowledge work (refineries, PSUs, defence manufacturing, government). The
problem it targets: employees cannot use cloud AI (Claude/ChatGPT) on classified data —
P&IDs, financials, inspection reports — so they either work manually or quietly paste
confidential data into public tools.

LEX's pitch: a deployable, on-premise **agent system** (not a chatbot) that plans
multi-step work, routes to local specialist models, produces real Office deliverables
(`.docx` + `.xlsx`), and **proves zero data egress** with a live network monitor.

State of the repo: late prototype. 3 git commits, a 541-line `PROJECT_BRIEFING.md`
(with full pitch guide + judge Q&A), an `implementation_plan.md` for "Phase 2"
(auth, deliverables, audit, file tools), and a working codebase behind it.

---

## 2. Architecture

```
Frontend (React 19 + TanStack Start, Lovable-generated)
   │  REST + JWT  (hardcoded http://127.0.0.1:8000)
Backend (FastAPI + LangGraph, Python 3.14)
   ├── Planner LLM ──────────────► Ollama (qwen2.5:7b)
   ├── Vision/OCR tiered ────────► pypdf → Tesseract → Moondream VLM
   ├── RAG ──────────────────────► LanceDB + BGE-small (CPU)
   ├── Code execution ───────────► Docker+gVisor → local subprocess fallback
   ├── Auth ─────────────────────► SQLite + bcrypt + JWT (HS256)
   ├── Deliverables ─────────────► python-docx + openpyxl
   └── Sovereignty proof ────────► /proc/net/tcp reader
```

**Agent pipeline** (`backend/agent/agent_graph.py`): a 5-node LangGraph state machine —
`planner → router → [approval_gate] → execute_tool → router … → synthesize → END`.
The planner emits a Pydantic-validated `ExecutionPlan` (subtasks with DAG dependencies +
`requires_approval` flags); the router picks the next ready subtask;
`interrupt_before=["approval_gate"]` halts for human sign-off with SQLite checkpointing;
the synthesize node drafts the approval note and writes `.docx` + `.xlsx`.

This is a genuinely correct use of LangGraph — conditional edges, a loop, interrupts, and
persistence all in the right places.

---

## 3. Codebase Inventory

| Area | Size | Notes |
|---|---|---|
| Backend (excl. venv) | ~1,740 lines in 15 modules | Compact, readable |
| Frontend dashboard | ~1,300 lines + 45 shadcn/ui boilerplate | Lovable/TanStack Start |
| `backend/venv` | 6.2 GB | Untracked (correct) |
| `frontend/node_modules` | 382 MB | **31,091 files tracked in git** (wrong) |
| Docs | 541 + 133 lines | Excellent quality |
| Git history | 3 commits | Last commit "updated code" |

---

## 4. What Actually Works (Verified by Running)

- ✅ **Backend imports cleanly** in the Python 3.14 venv; all 14 routes register
  (`/api/auth/*`, `/api/tasks/*`, `/api/files/upload`, `/api/models`,
  `/api/network/status`, `/api/audit/*`).
- ✅ **Ollama is live** with `qwen2.5:7b-instruct-q4_K_M`, `sam860/qwen3:8b-Q4_K_M`,
  `phi4-mini`; Tesseract installed.
- ✅ **`data/audit_log.jsonl` proves a real end-to-end run**: task submitted → planner
  (14.4 s, real LLM latency) → OCR → approval gate (admin approved) → general reasoning
  (8 s) → synthesis (38 s) → `.docx` + `.xlsx` generated. Real deliverables exist in
  `data/`.
- ✅ `users.db` seeded with the 3 preset accounts; LanceDB store contains the ingested
  SOP-402.

The core loop is real, not vaporware.

---

## 5. Subsystem Assessment

### Agent graph — good
Structured-output planning, dependency-ordered routing, HITL interrupt, checkpointing.
Two weaknesses:
- The "live" trace is **post-hoc** — `POST /api/tasks/submit` blocks the HTTP request
  until interrupt/END (~1 min), then the frontend renders all steps at once from final
  state. No streaming (SSE/WebSocket) despite `types.ts` defining an `AgentEvent` union
  clearly designed for it.
- **Rejection is a dead end** — the backend returns `{"status": "rejected"}` but the
  graph stays paused at `approval_gate` forever (no cancel/resume path).

### Multi-model registry — as advertised, mostly
Config-driven `ModelSpec` list, task-type → model routing table, live Ollama availability
probe. But docs/code disagree on tags (briefing says `qwen2.5:7b-instruct-q4_K_M`; code
uses `qwen2.5:7b`; frontend fallback mentions a nonexistent `qwen2.5-coder:7b`), and the
"coder" model is the same 7B as the planner — a label, not a distinct model.

### Tiered OCR — the weakest "real" claim
1. **Scanned PDFs are never actually OCR'd.** In `multimodal.py`, when a PDF has <50
   chars of embedded text, the code sets `raw_text` to a placeholder string. The comment
   admits: *"For multi-page PDF images in prod, render page to image first."* No page
   rendering exists (no pymupdf/pdf2image in the venv).
2. **Hardcoded fallback fabricates data.** `agent_graph.py`: if the attached file can't
   be resolved on disk, the "OCR" output is the literal string
   `[OCR Extracted]: Line Tag: P-104A | Measured Pressure: 17.8 bar | Status:
   Overpressure Alarm.` The audit log shows the recorded demo run hit exactly this path
   (`execute_vision_ocr` in **0.1 ms**). The demo works without ever touching the actual
   scan — which undercuts the "we don't trust the LLM with facts" pitch.
3. Only the **first** attached file is ever processed.

### RAG — solid for a demo
BGE-small on CPU with `local_files_only` (with a first-run HuggingFace download fallback —
an egress the sovereignty monitor would flag, and a contradiction of the air-gap claim on
first boot), word-based 500/50 chunking, embedded LanceDB, source-cited retrieval.
Minor: f-string interpolation into the `where()` clause (internal-only, low risk).

### Sandbox — two-tier, with a real gap
Docker+gVisor (`--network=none`, 128 MB, 1 CPU) when available; otherwise a **local
subprocess running as the backend user** with only a stripped env, 10 s timeout, and a
temp cwd. LLM-generated code executing on the host with no filesystem isolation is a
genuine risk for a "sovereign" system; the fallback is a demo convenience, not a security
boundary.

### Prompt-injection sanitizer — reasonable demo, thin defense
8 regex patterns, defanging (`[DEFANGED_INJECTION: …]`), HTML-escaping, XML envelope +
guardrail notice. Easily bypassed (paraphrase, encoding, multi-line splits). Fine as a
hackathon feature; not a real control.

### Network sovereignty monitor — impressive idea, incomplete implementation
Reads `/proc/net/tcp` at the kernel level and classifies loopback vs. outbound — a
genuinely better "proof" than a checkbox. But it **only covers IPv4 TCP**: no
`/proc/net/tcp6`, no UDP — and on non-Linux it silently returns empty, which reports
`sovereign: true` (false positive). The UI's "0 outbound" badge is only as strong as this
file.

### Auth — clean and correct for scope
SQLite + bcrypt + HS256 JWT, 24 h expiry, `require_admin` dependency, 3 seeded users,
client-side guard in `__root.tsx`, logout in header. Standard caveats: hardcoded default
JWT secret (documented), no rate limiting, client-side-only guard, no token revocation.

### Audit logging — good
Append-only JSONL with task/step/model/duration/user, capped summaries, admin-only
endpoints. The log is the best evidence in the repo that the system actually ran.

### Frontend — polished, with real integration
Dark industrial theme (oklch tokens, galaxy-brain animation), login page with
demo-credential buttons, user/role badge, live model drawer (real `/api/models`),
3-second network polling, composer with drag-drop upload, approval card with amber halo +
reject-with-reason, deliverable card with dual DOCX/XLSX download (real backend fetch + a
hand-rolled client-side ZIP/OOXML docx writer as fallback — a nice touch).

---

## 6. Bugs & Doc/Code Mismatches

| # | Where | Issue |
|---|---|---|
| 1 | `frontend/src/routes/index.tsx` | 2 TypeScript errors: dev demo buttons pass `{requireApproval}`/`{shouldFail}` as the `files: File[]` argument of `sendTask` — leftover from the mock engine. |
| 2 | `useAgentStore.ts` (model label) | Ternary-precedence bug: `a \|\| b ? c : d` — every completed step displays `"qwen2.5-coder:7b → sandbox"` regardless of the actual model. |
| 3 | `useAgentStore.ts` | Silently attaches `boiler_scan.pdf` when no files were uploaded. |
| 4 | `useAgentStore.ts` | `kbDocCount` hardcoded to 1; `ingestDocument()` just increments a counter (no API call); deliverable size hardcoded "38 KB". |
| 5 | `agent_graph.py` | Hardcoded fake OCR fallback. |
| 6 | `multimodal.py` | Scanned-PDF path returns a placeholder instead of rendering pages to images. |
| 7 | `main.py` (approve) | Rejection leaves the graph paused with no cancel path. |
| 8 | `main.py` (upload) | Uploads: no size limit, no type validation, basename collisions overwrite. |
| 9 | `network_monitor.py` | IPv4-TCP-only; non-Linux → false "sovereign". |
| 10 | `rag_engine.py` | First-run HF download = egress on an "air-gapped" system. |
| 11 | `implementation_plan.md` vs code | `file_operation` task type + wiring never implemented — `file_tools.py` is dead code. `ToolExecutionResult` schema unused; `mockEngine.ts` dead. `.bak` files committed. |
| 12 | Paths | Relative `data/` paths make behavior CWD-dependent — both `data/` and `backend/data/` exist with overlapping artifacts. |
| 13 | Briefing vs code | Model tags, "5 models" drawer, 4-subtask demo flow (recorded run produced only 2 subtasks) — docs describe a slightly different system. |

---

## 7. Repository Hygiene (Biggest Practical Problem)

- **31,091 `node_modules` files are tracked in git.** The `.gitignore` has the rule, but
  the files were committed before it. The last commit even churns node_modules. This
  bloats the repo ~400 MB+ and will fail most submission checks.
- Stray `frontend/Friendly Frontend Forge/` Lovable folder (holds the `.lovable` project
  manifest — keep it), both `bun.lock` and `package-lock.json`, empty `infra/`,
  unpinned `requirements.txt`, committed demo deliverables + audit log, `.bak` files.
- The 6.2 GB venv is correctly untracked.

---

## 8. Security Posture Summary

| Control | State |
|---|---|
| AuthN | ✅ JWT + bcrypt, local SQLite |
| AuthZ | ✅ admin vs operator on audit endpoints |
| CORS | ✅ localhost-only origins |
| Injection defense | ⚠️ Regex defanging — demo-grade |
| Code sandbox | ⚠️ gVisor if available; **host-local subprocess otherwise** |
| Egress proof | ⚠️ IPv4-TCP-only monitor; HF download on first run |
| Secrets | ⚠️ Hardcoded default JWT secret |
| Uploads | ⚠️ No validation |
| Data at rest | ✅ All local (SQLite/LanceDB/JSONL) |

---

## 9. Verdict

A well-architected, genuinely working hackathon prototype with strong documentation and a
few demo shortcuts that weaken its own claims. The LangGraph pipeline, auth, audit trail,
RAG, and deliverable generation are real and verified. The "sovereignty" story — the
project's differentiator — is undermined in three places: the OCR fallback that fabricates
readings, the network monitor's IPv4-only coverage, and the first-run model download. The
repo itself (committed node_modules, dead code, .bak files) needs a cleanup pass before
submission.

## 10. Prioritized Recommendations

1. **Untrack node_modules** (`git rm -r --cached frontend/node_modules` + commit;
   consider `git filter-repo` to scrub history).
2. **Make OCR real for the demo path**: render PDF pages to images (pymupdf/pdf2image) →
   Tesseract/VLM; remove or clearly gate the hardcoded fallback.
3. **Fix the 2 TS errors** and the model-label ternary; remove `mockEngine.ts`, `.bak`
   files, and dead `file_tools.py`/`ToolExecutionResult` (or wire them in).
4. **Extend the network monitor** to `tcp6`/`udp` and fail loudly (not "sovereign") on
   non-Linux.
5. **Add a rejection path** that cancels the graph (or mark the task aborted in state).
6. **Validate uploads** (size cap, allow-listed extensions) and pin `requirements.txt`.
7. **Add SSE streaming** for the trace (the `AgentEvent` union is already designed for
   it) — turns the post-hoc trace into the "live" one the pitch promises.
8. Reconcile the briefing with the code (model tags, subtask counts) so judges can't spot
   the drift.
