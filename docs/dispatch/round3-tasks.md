# LEX — Round 3 Task Dispatch (corrected, 2026-09-28)

Supersedes any earlier `docs/dispatch/round3-tasks.md`. Read §0-§2, then only your own
seat's §3 section.

Goals: (a) close out Round 2 with real evidence, (b) bring `frontend-sparkle/` (pure
client-side SPA) up to the contracts and wire it to the live backend, (c) run one
end-to-end acceptance flow on the mock LLM.

---

## 0. Rules

1. Rules 1-10 of `docs/dispatch/round2-tasks.md` §0 stay in force. The critical ones:
   git is read-only; non-interactive commands only (`-y`, `< /dev/null`, no `yes`, no
   pagers); one heavy process per seat at a time (the host crashed from RAM exhaustion);
   "done" = command + real output in `PROGRESS.md`; no invented numbers, endpoints,
   citations or file contents; stay in your lane.
2. **Frontend scope:** work in `frontend-sparkle/`. Do NOT delete or modify `frontend/`
   (legacy, kept as fallback until the human decides otherwise).
3. **Air-gap:** no external fonts, CDNs, analytics, or QR services. QR codes render only
   from the server's base64 PNG.
4. **Endpoints:** the source of truth is the running backend. Use
   `curl -s http://127.0.0.1:8001/openapi.json` or
   `grep -rnE '@(app|router)\.(get|post|put|delete)' backend/`. Endpoint names in this
   file are hints; a 404 means fix your code or ask orch1.lead for a backend change.
   Never invent an endpoint.
5. **Backend** (run once from the workspace root, reuse it, stop it when done):
   `USE_MOCK_LLM=1 backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001`
   There is no Ollama or GPU here. Run `grep -rn USE_MOCK_LLM backend/` to confirm where
   the flag is read; if the running app does not honor it, tell orch1.lead.
6. **Frontend dev server:** `npm run dev -- --host 0.0.0.0 --port 5174` with `/api`
   proxied to `http://127.0.0.1:8001` in `vite.config.ts`.
7. No mock data in shipped views. `src/mocks/` may remain only if nothing in `src/`
   outside tests imports it and the string "mocks/" is absent from `dist/`.

---

## 1. Endpoints and contracts

Frozen contracts: `docs/contracts/auth.md`, `reports.md`, `audit-chain.md`.

Previously observed in this repo (confirm against openapi before use):
- `POST /api/tasks/submit` — accepts `routing_weights` and `prompt_compression`
- `POST /api/tasks/{task_id}/approve` — body `{approved: bool}`; rejection = `approved:false`
- `GET /api/models`, `GET|POST /api/models/routing-scores`, `GET|PUT /api/user/preferences`
- `GET /api/health`, `GET /api/network/status`

Claimed by a seat but never verified: `/api/analytics`, `/api/models/stats`,
`/api/audit/log`. Treat as UNKNOWN until they appear in openapi.

The endpoints `/api/agent/chat`, `/api/agent/approve` and `/api/agent/reject` from an
earlier draft do NOT exist. Do not use them.

**Downloads:** `window.open` and anchor navigation cannot send an `Authorization` header,
so the authenticated `.docx` download must use `fetch` with the header, then a blob and an
object URL.

---

## 2. Sequencing

**Gate 0 — Round 2 closeout (orch1.lead, before any dispatch).** Paste output for each:
1. `backend/.venv/bin/python -m pytest backend -q` (tail of the output).
2. Start the backend. Through the API, complete at least 5 mock-LLM tasks so the audit
   chain has at least 5 entries. Run
   `backend/.venv/bin/python -m backend.tools.verify_audit_chain`; it must show
   `valid: true` and `entries_checked >= 5`. (A result of `entries_checked: 1` only
   proves the chain_start marker exists.) Then copy the log, alter one field mid-file,
   run the verifier on the copy: it must report invalid at the correct `seq`.
3. Record in `PROGRESS.md`: `INDEPENDENT_REVIEW_REPORT.md`,
   `INDEPENDENT_VERIFICATION_REPORT.md` and `QA_VERIFICATION_REPORT.md` are dated
   2026-09-27 and predate Round 2. They are NOT the Round 2 reviews; those are still owed
   (rev1.r1 and rev1.r2 sections below).

**Gate 1 — frontend parity (dev1.design, first task).** Write `docs/frontend-parity.md`:
routes and features of `frontend/` vs `frontend-sparkle/`. Known so far: sparkle has Chat,
Routing, Approvals, Settings; the legacy app also had a Models page with score table,
Analytics, Audit log table, Per-model breakdown, Login. orch1.lead reports the gaps to the
human and waits for a decision before anything in `frontend/` is retired. Work needed in
either case (login/OTP, reports, audit verify, live API wiring) proceeds meanwhile.

**Then in parallel:** dev1.impl, dev1.design, orch1.peer. **Then:** dev1.qa, rev1.r1,
rev1.r2. **Then:** §4.

**Ownership:** dev1.design owns `App.tsx`. dev1.impl owns `src/lib/*` and does not edit
`App.tsx`; it sends needed changes to dev1.design. To unblock design, dev1.impl posts these
final signatures in `PROGRESS.md` as its first step:
`useAuth(): {token, role, status, login(u,p), verifyMfa({code|backupCode}), enroll(), confirm(code), logout()}`,
`useMonthlyReport(month)`, `useAuditStatus()`.

---

## 3. Seat sections

### orch1.lead
1. Run Gate 0. Start the backend once (§0 rule 5).
2. Dispatch each seat by pointing it at its §3 section; do not paraphrase.
3. Enforce the ownership rule; relay Gate 1 findings to the human and wait.
4. Run §4 yourself. Do not declare anything complete without the output.

### dev1.impl
1. Read `frontend-sparkle/src/mocks/api.ts` and `src/lib/types.ts`. Post a table
   mock call -> live endpoint (from openapi).
2. `src/lib/api.ts`: fetch wrapper with Bearer token; on 401 clear the session and route
   to login; on 429 surface `retry_after_s`; a `downloadBlob` helper.
3. Wire ChatView -> `POST /api/tasks/submit` (plus whatever task-status endpoint openapi
   shows), ApprovalView -> `POST /api/tasks/{id}/approve`, RoutingView ->
   `/api/models/routing-scores` and `/api/user/preferences`, compression settings ->
   `/api/user/preferences`.
4. Implement the hooks with the agreed signatures.
5. Evidence: a `curl` of every endpoint used, and `npm run build` output.

### dev1.design
1. Gate 1 inventory.
2. `vite.config.ts`: `/api` proxy and `server.host`.
3. `LoginView` per `auth.md`: password -> `mfa_required` (TOTP or backup code) or
   `enrollment_required` (QR from `qr_png_base64`, backup codes shown once, confirm code).
   Handle `invalid_code` and `locked` with `retry_after_s`.
4. `ReportsView`: `<input type="month">`; tables for totals, by_model, by_task_type,
   daily; `null` renders as "Not recorded", never 0; `.docx` export via authenticated
   fetch/blob; show a clear message on 403.
5. `AuditView`: integrity badge (valid / invalid at `first_invalid_seq` / error),
   `entries_checked`, `chain_start_seq`, `legacy_unhashed_entries`.
6. `App.tsx`: login gate, Reports and Audit navigation, logout.
7. Evidence: build output and the list of files changed.

### orch1.peer
1. Obtain a token for a seeded user through the API: login -> enroll -> compute the code
   with `pyotp` from the secret in `otpauth_uri` -> confirm. Never write passwords,
   secrets, codes or tokens into `PROGRESS.md` or logs.
2. Submit tasks with `POST /api/tasks/submit` (mock LLM), approve them via `/approve`,
   until at least 5 new chained entries exist. Coordinate with orch1.lead so Gate 0 and
   this step are not duplicated.
3. Paste the verifier output; `entries_checked` must exceed 1.

### dev1.qa
1. The `frontend-sparkle/node_modules` symlink points at the legacy app, and
   `package.json` says `vite ^7` while the last build ran vite 8.1.5. Replace the symlink
   with a real install (`rm node_modules && npm install --no-audit --no-fund`), run
   `npm ls vite`, and fix `package.json` to what actually builds.
2. `npm run build` and `npx tsc --noEmit`; report bundle sizes.
3. Air-gap scan; classify every hit:
   `grep -rnP 'https?://(?!(127\.0\.0\.1|localhost|www\.w3\.org|react\.dev)\b)' frontend-sparkle/src frontend-sparkle/dist frontend-sparkle/index.html; echo "grep exit=$?"`
   (exit 1 = no hits, 0 = hits to review, 2 = grep error — an error is NOT a pass).
4. Contract checks for auth, reports and audit-verify with `curl`. Do not install
   Playwright or Cypress.
5. With the backend stopped, run `npm run preview` and check that the app shows an error
   state. Label each check "exercised" or "code-reviewed".

### rev1.r1 (security)
1. Against the running backend, use the `operator` account or a scratch user (lockout is
   per username for 5 minutes): replay a TOTP code, 6 wrong codes (expect 429), an
   expired `mfa_token`, an `enroll_token` on a normal endpoint, a backup code twice.
2. Call `/api/reports/monthly` and `/api/audit/verify` without a token. The contract does
   not specify auth for verify: report the actual behavior and recommend.
3. Check `data/.jwt_secret` is mode 0600 and not in `git status`; check that secrets do
   not appear in logs.

### rev1.r2 (data + reports)
1. Compute the monthly figures independently from the audit log with a small script and
   compare with the API response. Confirm unrecorded fields are `null`.
2. `.docx`: `curl -sI` for the content type and `python -m zipfile -l` for a valid
   container.
3. Tamper test on a COPY of the log with the CLI verifier. For the UI's invalid state,
   read the component branch and label it "code-reviewed" unless you can exercise it.
4. Round 2 data artifacts: check `data/fine_tuning/SOURCES.md`, `splits.json`,
   `scripts/check_leakage.py`, `test_verification.jsonl`. Run the leakage check. Write
   NOT FOUND for anything missing.

---

## 4. Acceptance (orch1.lead runs; paste all output)

```
cd /home/sandbox/workspace
backend/.venv/bin/python -m pytest backend -q
backend/.venv/bin/python -m backend.tools.verify_audit_chain
(cd frontend-sparkle && npm run build && npx tsc --noEmit)
grep -rnP 'https?://(?!(127\.0\.0\.1|localhost|www\.w3\.org|react\.dev)\b)' frontend-sparkle/src frontend-sparkle/dist frontend-sparkle/index.html; echo "grep exit=$?"
grep -rln "mocks/" frontend-sparkle/src
git --no-pager status --short
```

End-to-end transcript (tokens redacted): password login -> TOTP verify -> submit task ->
approve -> `GET /api/reports/monthly` for the current month includes the task ->
`GET /api/audit/verify` is valid with `entries_checked` higher than before.
