# Phase 2 — Auth, Deliverables & Complete PS Coverage

## Goal

Add role-based authentication (Admin vs Operator), Excel deliverable output, agent file tools, audit logging, and sample demo data — completing full coverage of Problem Statement #26117.

> [!IMPORTANT]
> The PS does NOT explicitly require sign-in, but adding it makes the project enterprise-ready and more impressive for judges. This will be a **lightweight local auth** — no external services, all data stays on-premise.

## Open Questions

> [!IMPORTANT]
> **Auth complexity**: Should this be a full login page with user registration, or a simpler hardcoded admin/operator demo? A full system adds ~3 hours; a demo-ready setup with 2 preset users takes ~1 hour. **Recommendation**: Preset users for demo speed.

---

## Proposed Changes

### Auth System (Local JWT + SQLite)

#### [NEW] `backend/auth.py`
- Local user store in SQLite (`data/users.db`) with bcrypt-hashed passwords
- Two preset users seeded on first boot:
  - `admin` / `admin123` → role: `admin`
  - `operator` / `operator123` → role: `operator`
- JWT token generation (signed with a local secret, HS256)
- `get_current_user()` FastAPI dependency for protected routes
- Admin-only endpoints: model management, user management, audit log download
- Operator endpoints: submit tasks, approve/reject, download deliverables

#### [MODIFY] [`backend/main.py`](file:///home/ujjwal/Projects/lex/lex/backend/main.py)
- Add `POST /api/auth/login` — accepts username/password, returns JWT
- Add `GET /api/auth/me` — returns current user info
- Protect task/upload/model endpoints with `Depends(get_current_user)`
- Admin-only: `GET /api/audit/log`, `GET /api/models` (write ops)

#### [NEW] `frontend/src/routes/login.tsx`
- Login page with username/password form
- Industrial dark theme matching existing design
- Stores JWT in `localStorage`
- Redirects to `/` on success

#### [MODIFY] [`frontend/src/routes/__root.tsx`](file:///home/ujjwal/Projects/lex/lex/frontend/src/routes/__root.tsx)
- Auth guard: redirect to `/login` if no token
- Pass `user` context to child routes

#### [MODIFY] [`frontend/src/lib/agent/useAgentStore.ts`](file:///home/ujjwal/Projects/lex/lex/frontend/src/lib/agent/useAgentStore.ts)
- Attach `Authorization: Bearer <token>` header to all API calls
- Add `user` info (name, role) to store

#### [MODIFY] [`frontend/src/components/dashboard/Header.tsx`](file:///home/ujjwal/Projects/lex/lex/frontend/src/components/dashboard/Header.tsx)
- Show logged-in user name + role badge
- Add logout button

---

### Excel Deliverable

#### [MODIFY] [`backend/agent/agent_graph.py`](file:///home/ujjwal/Projects/lex/lex/backend/agent/agent_graph.py)
- In `synthesize_deliverable_node`: also generate `.xlsx` with calculation results table via `openpyxl`
- Store path in `deliverable_path` (keep docx as primary, add xlsx as secondary)

#### [MODIFY] [`backend/main.py`](file:///home/ujjwal/Projects/lex/lex/backend/main.py)
- Add `GET /api/tasks/{task_id}/download/xlsx` endpoint

---

### Agent File Read/Write Tools

#### [NEW] `backend/tools/file_tools.py`
- `tool_read_file(path)` — read text/PDF/image from `data/uploads/`
- `tool_write_file(filename, content)` — write to `data/outputs/`
- Path sanitization to prevent directory traversal

#### [MODIFY] [`backend/agent/agent_graph.py`](file:///home/ujjwal/Projects/lex/lex/backend/agent/agent_graph.py)
- Add `file_operation` task type in `execute_tool_node`
- Wire to file_tools functions

---

### Audit Logging

#### [NEW] `backend/tools/audit_logger.py`
- Structured JSON logger for every agent step
- Writes to `data/audit_log.jsonl` (append-only)
- Fields: timestamp, task_id, step_type, model_used, duration_ms, input_summary, output_summary

#### [MODIFY] [`backend/agent/agent_graph.py`](file:///home/ujjwal/Projects/lex/lex/backend/agent/agent_graph.py)
- Log each node entry/exit to the audit logger

#### [MODIFY] [`backend/main.py`](file:///home/ujjwal/Projects/lex/lex/backend/main.py)
- `GET /api/audit/log` — returns last N entries (admin only)
- `GET /api/audit/log/download` — download full JSONL file

---

### Sample Demo Data

#### [NEW] Sample files in `data/sample_documents/`
- Generate a synthetic scanned inspection report PDF (image-based)
- Generate a simple P&ID diagram image
- These give judges real multimodal content to test with

---

## Verification Plan

### Automated Tests
```bash
# Backend import check
source venv/bin/activate
python -c "from backend.main import app; print('OK')"

# Auth flow test
curl -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operator","password":"operator123"}'

# Protected endpoint test (should fail without token)
curl http://127.0.0.1:8000/api/models
# Should return 401

# With token
curl http://127.0.0.1:8000/api/models \
  -H "Authorization: Bearer <token_from_login>"
```

### Manual Verification
- Open http://localhost:8080 → should redirect to login page
- Login as operator → see dashboard, can submit tasks
- Login as admin → see dashboard + audit log access
- Submit a task → check `data/audit_log.jsonl` has entries
- Complete a task → verify both `.docx` and `.xlsx` deliverables generated
