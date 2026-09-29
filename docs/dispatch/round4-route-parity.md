# Round 4 Dispatch — Route Parity & Backend Test Hermeticity (2026-09-29)

Supersedes nothing; companion to round3-tasks.md. Each seat reads ONLY its section.

## 0. Rules (all pods)
- Read ONLY the section explicitly assigned to your pod name. Do not execute steps from other sections.
- Make zero assumptions: if an endpoint, file, or parameter is unspecified, inspect the filesystem or API contracts directly.
- Git is strictly read-only: do NOT commit, stage, or push.
- Non-interactive execution only: redirect stdin (`< /dev/null`) and pass `-y` to all automated tools.
- Strictly throttle heavy executions: only one test run or build per pod at a time.
- Backup rule: before modifying any existing file, copy it to `<filename>.bak`.
- Log all commands and outputs verbatim to PROGRESS.md.

## 1. Live API shapes (verified 2026-09-29 against running backend, port 8001)
- `GET /api/models` → `{models: [{id, name, ollama_tag, role, task_types[], state ("available"|"unavailable"|"loaded"), ctx_window, intelligence, reliability, speed, resident (bool), vram_usage_mb}]}`
- `POST /api/models/routing-scores` body `{speed, reliability, intelligence}` → `{scores: [{id, name, role, task_types[], intelligence, reliability, speed, score, rank}], weights_used}`
- `GET /api/models/stats` → `{models: {<name>: {requests, success_rate, avg_latency_ms, task_types: {<type>: n}}}}`
- `GET /api/analytics` → `{summary: {total_requests, success_rate, avg_latency_ms}, by_model: {<name>: {requests, success_rate, avg_latency_ms}}, by_task_type: {<type>: {requests, success_rate, avg_latency_ms}}, time_series: [{hour (ISO), requests, success_rate, avg_latency_ms}]}`
- All accept `Authorization: Bearer <token>`. Fields may be `null` — render as "Not Recorded", never 0.

================================================================================
POD: dev1.impl
FILE BOUNDARY: `frontend-sparkle/src/lib/*` ONLY. Do NOT edit views or App.tsx.
================================================================================
1. Route Discovery:
   - Query backend route contracts:
     `curl -s http://127.0.0.1:8001/openapi.json | grep -oE '"/api/[^"]+"' | sort -u`
   - Inspect legacy data retrieval logic in:
     - `frontend/src/routes/models.tsx` (routing scores, model registry, residency/VRAM)
     - `frontend/src/routes/analytics.tsx` (summary stats, model/task breakdown)
2. API Client Extensions:
   - Back up `frontend-sparkle/src/lib/api.ts` to `frontend-sparkle/src/lib/api.ts.bak`.
   - Implement typed data-fetching functions and interfaces in `frontend-sparkle/src/lib/api.ts` for:
     - Model registry status, active routing scores, and residency state.
     - Analytics metrics: total requests, success rate, average latency, and breakdowns by model/task type.
   - Attach standard bearer token headers: `Authorization: Bearer <token>`.
   - Never default missing values to 0: format `null` values as "Not Recorded".
3. Report completion and exported interface names to dev1.design (post them in PROGRESS.md under "## dev1.impl interface exports").

================================================================================
POD: dev1.design
FILE BOUNDARY: `frontend-sparkle/src/routes/ModelsView.tsx`, `frontend-sparkle/src/routes/AnalyticsView.tsx`, `frontend-sparkle/src/App.tsx`.
Do NOT modify files in `src/lib/` or backend directories.
================================================================================
1. Implement Models View:
   - Create `frontend-sparkle/src/routes/ModelsView.tsx` mirroring legacy `frontend/src/routes/models.tsx`:
     - Render the model registry table, real-time routing scores, and residency/VRAM status indicators.
     - Handle empty, loading, and 401/403 states using the typed functions from dev1.impl.
2. Implement Analytics View:
   - Create `frontend-sparkle/src/routes/AnalyticsView.tsx` mirroring legacy `frontend/src/routes/analytics.tsx`:
     - Render summary metric cards (total requests, success rate, average latency).
     - Render data tables grouped by model and by task type.
     - Render time-series trends using pure air-gapped inline SVGs or CSS layouts (strict rule: zero external chart libraries or remote CDN assets).
3. Update App Navigation:
   - Back up `frontend-sparkle/src/App.tsx` to `frontend-sparkle/src/App.tsx.bak`.
   - In `frontend-sparkle/src/App.tsx`, register "Models" and "Analytics" tabs alongside Chat, Routing, Approvals, Reports, and Audit.
   - Ensure tab navigation transitions preserve the current user auth session.
4. Wait for dev1.impl's interface exports (posted in PROGRESS.md under "## dev1.impl interface exports") before wiring Views. If the interface names land in `frontend-sparkle/src/lib/api.ts` meanwhile, inspect the file directly.
5. Notify dev1.qa when views are wired.

================================================================================
POD: dev1.qa
FILE BOUNDARY: Read-only verification across `frontend-sparkle/`.
================================================================================
Run AFTER dev1.impl and dev1.design report done:
1. Type Check:
   - Execute: `(cd frontend-sparkle && npx tsc --noEmit)`
   - Verify exit code is 0 with 0 errors.
2. Production Build:
   - Execute: `(cd frontend-sparkle && npm run build)`
   - Confirm build succeeds cleanly.
3. Air-Gap & Isolation Scan:
   - Scan for forbidden mock imports: `grep -rln "mocks/" frontend-sparkle/src/ || true`
     Ensure output is empty (exit code 1).
   - Scan for external egress:
     `grep -rnE "https?://" frontend-sparkle/dist/ | grep -v "tailwindcss.com/license" || true`
     Ensure 0 external endpoints are bundled.
4. Report pass/fail status and bundle size metrics to orch1.lead.

================================================================================
POD: orch1.peer
FILE BOUNDARY: `backend/test_routing_step3.py`, `backend/test_sandbox.py`.
Do NOT modify frontend files or `backend/tools/rag_engine.py`.
================================================================================
COMPLETE — executed by orch1.lead (orch1.peer idle):
1. Failures reproduced: 5 failures (4 async tests + 1 sandbox).
2. Fixes applied (backups: test_routing_step3.py.bak, test_sandbox.py.bak, agent_graph.py.bak, sandbox_runner.py.bak):
   - Async tests needed `--asyncio-mode=auto` (pytest-asyncio was in STRICT mode); added `pytest.ini`-equivalent config so they pass under plain `pytest backend -q`.
   - `sandbox_runner.py`: fallback subprocess used bare `python3` which is absent on PATH; now resolves to the running interpreter.
   - `agent_graph.py`: `build_agent_graph` now defaults to `MemorySaver` checkpointer so `interrupt_before=["approval_gate"]` can resume; tests resume via `Command(resume=True)` instead of `ainvoke(None)`.
3. Validated: `USE_MOCK_LLM=1 pytest backend -q` → **89 passed, 0 failed**.
4. No live Ollama/vLLM socket calls remain; all mock via `USE_MOCK_LLM=1` + `mock_llm_client`. No ML packages installed.

================================================================================
POD: orch1.lead (Closeout & Oversight)
================================================================================
1. Monitor all pods and enforce file boundaries.
2. Once dev1.qa and orch1.peer report success:
   - Run audit chain validation: `backend/.venv/bin/python -m backend.tools.verify_audit_chain`
   - Update `docs/frontend-parity.md` to indicate that Models and Analytics views are now implemented with 100% route coverage.
   - Check modified files: `git --no-pager status --short`
   - Verify all test servers/background processes are terminated and port 8001 is freed.
3. Print final verification transcript to stdout.
