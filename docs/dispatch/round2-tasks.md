# LEX — Round 2 Task Dispatch (2026-09-28)

Authoritative task file for all seats. Read §0 and §1, then only your own seat's
section in §3. Do not rely on any relayed paraphrase of this file.

Goals this round: (a) TOTP-based auth, (b) monthly statistics report, (c) tamper-evident
audit log, (d) fine-tuning data + evaluation pipeline, (e) frontend for a/b/c.

---

## 0. Rules for every seat

1. **Git:** stay on the current branch (`feat/sih-lex`). Never commit, push, merge, rebase,
   checkout, stash, or `git add`. Read-only git (`git --no-pager status|diff|log`) is fine.
   The human reviews and commits.
2. **Third-party files:** `docs/fine-tune/` holds third-party PDFs. Read only; never edit,
   move, or delete them.
3. **Environment:** no Docker, GPU, root, or Ollama. Python is `backend/.venv/bin/python`,
   run from the workspace root (`/home/sandbox/workspace`). Install packages with
   `uv pip install --python backend/.venv/bin/python <pkg>` and add each to
   `requirements.txt`. Do NOT install torch, transformers, vllm, or other large ML
   packages (RAM/disk).
4. **Non-interactive only:** always pass `-y`/`--yes`, redirect `< /dev/null`, never pipe
   `yes`, no editors, no pagers. Commands that wait on stdin hung two seats overnight.
5. **Memory:** the host has crashed from RAM exhaustion. At most one heavy process per seat
   at a time (test suite, build, dev server). Start the backend once (port 8000), reuse it,
   stop it when finished. Kill any background process you start.
6. **Shared files:** `backend/main.py` and `frontend/src/lib/agent/useAgentStore.ts` are
   touched by several seats. Put new code in new modules; add only the minimum lines to
   shared files; re-read the file immediately before editing; keep diffs small.
7. **Evidence rule:** "done" means the command and its real output are pasted into
   `PROGRESS.md` (append only; heading = date, seat, task). "Should work" or "verified"
   without output does not count. Anything not run is written as `NOT RUN`.
8. **No invention:** no made-up numbers, benchmark scores, citations, URLs, dataset names,
   or file contents. Unknown -> write `UNKNOWN` and state what is needed. Fields absent
   from source data -> `null`.
9. **Lanes:** if you need a change in another seat's files, send orch1.lead the exact
   change; do not make it yourself.
10. **Report format:** (a) files changed, (b) commands run + output, (c) not done/blocked,
    (d) risks.

---

## 1. Contracts (authoritative)

orch1.lead copies each block verbatim into `docs/contracts/` (see §3). Field names are
exact. All JSON keys are snake_case.

### 1.1 Auth — `docs/contracts/auth.md`

Existing login response fields (whatever they are today) must keep working; fields below
are additions. If the existing shape conflicts with this contract, dev1.impl edits the
contract file and tells orch1.lead the same turn.

Policy: TOTP required for all users (RFC 6238, SHA-1, 6 digits, 30 s step). Accepted window
= +/-1 step, configurable via env `LEX_TOTP_WINDOW` (default 1). Enforcement toggle env
`LEX_REQUIRE_TOTP` (default `1`).

| Endpoint | Auth | Request | Success response | Errors |
|---|---|---|---|---|
| `POST /api/auth/login` | none | `{username, password}` | `{status, access_token?, token_type?, role?, mfa_token?, enroll_token?}` where `status` is `"ok"` (only if TOTP not required), `"mfa_required"` (enrolled -> `mfa_token`), or `"enrollment_required"` (not enrolled -> `enroll_token`) | 401 `{detail:"invalid_credentials"}`; 429 `{detail:"locked", retry_after_s:int}` |
| `POST /api/auth/totp/enroll` | `Bearer <enroll_token>` | none | `{otpauth_uri, qr_png_base64, backup_codes:[10 strings]}` (shown once) | 401 |
| `POST /api/auth/totp/confirm` | `Bearer <enroll_token>` | `{code}` | `{status:"ok", access_token, token_type:"bearer", role}` | 401 `{detail:"invalid_code"}` |
| `POST /api/auth/mfa/verify` | none | `{mfa_token, code?, backup_code?}` | `{status:"ok", access_token, token_type:"bearer", role}` | 401 `{detail:"invalid_code"\|"expired_mfa_token"}`; 429 locked |

Token scopes: `mfa_token` = JWT, 5 min, scope `mfa` (useless for any other endpoint).
`enroll_token` = JWT, 10 min, scope `enroll` (valid only for enroll/confirm).

Rules:
- A TOTP time-step can be used once per user (replay rejected).
- 5 consecutive failures (password or code) -> 5-minute lockout per username.
- Backup codes are single-use and stored hashed. The TOTP secret is stored server-side and
  never returned after enrollment.
- JWT secret comes only from env `LEX_JWT_SECRET`; if unset, generate once and persist to
  `data/.jwt_secret` (mode 0600, git-ignored). The old hardcoded default
  (`lex-sovereign-workbench-secret-key-change-in-prod`) must not exist anywhere in the repo.
- Never log secrets, codes, or tokens.

### 1.2 Monthly report — `docs/contracts/reports.md`

`GET /api/reports/monthly?month=YYYY-MM&format=json|docx` — admin role only
(403 otherwise, 400 on a malformed month, 200 with zeros if the month has no entries).

JSON body:
```
{month, generated_at, source_log, entries_in_month,
 totals: {tasks, completed, failed, success_rate, approvals, rejections},
 by_model: [{model, requests, success_rate, avg_latency_ms, input_tokens, output_tokens}],
 by_task_type: [{task_type, count, success_rate}],
 daily: [{date, tasks, failures}],
 egress: {outbound_connections, source}}
```
`success_rate` is a fraction 0-1 or `null`. Any figure the audit log does not record is
`null`, never estimated. `format=docx` returns the same content as tables plus a summary,
as attachment `lex-report-YYYY-MM.docx`.

### 1.3 Audit chain — `docs/contracts/audit-chain.md`

- Each new audit entry gains `seq` (int, 1 for the first chained entry), `prev_hash` (hex)
  and `hash` = HMAC-SHA256(key, prev_hash + canonical_json(entry without `hash`)), where
  `canonical_json = json.dumps(obj, sort_keys=True, separators=(",",":"))`.
- Key: env `LEX_AUDIT_HMAC_KEY`; fallback = derived from the JWT secret with a distinct
  label. Never a hardcoded constant. Genesis `prev_hash` = 64 zeros.
- Existing unhashed entries are left untouched. A `{"event":"chain_start", ...}` entry
  marks where hashing begins.
- Appends are serialized with a file lock so concurrent requests cannot fork the chain.
- `GET /api/audit/verify` -> `{valid, entries_checked, first_invalid_seq, chain_start_seq,
  legacy_unhashed_entries}` (`first_invalid_seq` and `chain_start_seq` may be `null`).
- CLI: `backend/.venv/bin/python -m backend.tools.verify_audit_chain [path]`; exit 0 = valid,
  1 = invalid.
- Documented limit: this is tamper-evidence against anyone without the key, not against
  someone who holds the key.

---

## 2. Sequencing

1. orch1.lead: contracts to `docs/contracts/`, identify the live audit log (§3), dispatch.
2. In parallel: dev1.impl (auth), orch1.peer (audit chain), dev1.qa (data pipeline),
   dev1.design (self-audit, then frontend against contracts).
3. dev1.impl starts the report backend only after orch1.lead accepts the auth work.
4. Reviewers start when an implementer reports, and review that work.
5. At most 3 seats run heavy commands concurrently.

---

## 3. Seat sections

### orch1.lead
1. Copy §1.1-§1.3 verbatim (no edits) to `docs/contracts/auth.md`, `reports.md`,
   `audit-chain.md`.
2. Two audit logs exist (`data/audit_log.jsonl` and `backend/data/audit_log.jsonl`).
   Determine which one the running app actually writes (grep the audit logger module for
   its path) and record the answer plus command in `PROGRESS.md` before dispatching peer
   and impl.
3. Dispatch each seat by telling it to read its own section of this file. Do not paraphrase
   task text.
4. Keep `PROGRESS.md` current. Do not declare any task complete; at the end run §4 yourself
   and report failures verbatim.
5. Out of scope: `docs/instructions/`, `openrig-specs/`, sandbox tooling.

### dev1.impl
**A. Auth backend (§1.1).**
1. Read `backend/auth.py` and the current login route. Paste the existing response shape
   into `PROGRESS.md` first.
2. `uv pip install --python backend/.venv/bin/python pyotp "qrcode[pil]"`; add to
   `requirements.txt`.
3. Implement in a new module (e.g. `backend/auth_mfa.py`) with a router; minimal
   registration lines in `main.py`. Remove the hardcoded JWT default; implement the
   env/persisted-file secret logic.
4. Tests in `backend/tests/test_auth_mfa.py` covering: enroll -> confirm -> login -> verify
   happy path (codes from `pyotp.TOTP(secret).now()`); replay rejected; 5 failures -> 429;
   expired `mfa_token`; `enroll_token` rejected on normal endpoints; backup code single-use;
   a test that fails if the old hardcoded secret string appears anywhere under `backend/`.
5. Show the enrollment flow works for all three seeded users (admin, operator, engineer).
   Never write seeded passwords into `PROGRESS.md`.

**B. Monthly report backend (§1.2)** — only after orch1.lead accepts A.
1. New module `backend/reports.py` plus router. Use the audit log orch1.lead identified.
2. Check `python-docx` is importable (`backend/.venv/bin/python -c "import docx"`); install
   if not. Tables only in the docx; no charts.
3. Tests with synthetic JSONL fixtures whose expected figures you compute by hand and
   write into the test as literals (do not compute expectations with the code under
   test). Include a month with no entries and an entry missing token/latency fields
   (-> `null`).
4. Run once against the real log and paste the JSON output.

### orch1.peer
Audit chain (§1.3).
1. Find every writer to the audit log (`grep -rn "audit_log" backend/`). Paste the current
   entry schema and the list of writers into `PROGRESS.md` first.
2. Implement the chained append (file lock via `fcntl.flock`), the verifier, the
   `/api/audit/verify` route in a new router module, and the CLI. Route every writer
   through the chained appender; list any that bypass it.
3. Tests: 50 concurrent appends (threads) produce a valid chain; editing a field, deleting
   a line, and reordering two lines are each detected at the correct `seq`; legacy entries
   are counted, not failed; missing/empty file -> `valid: true, entries_checked: 0`.

### dev1.qa
Fine-tuning data + evaluation pipeline. Inputs (read-only): `docs/fine-tune/` — three
OISD/API PDFs, one fire-protection PDF, `oisd-standards.txt`. Outputs under
`data/fine_tuning/`. Existing scripts in `data/fine_tuning/scripts/` may be reused; verify
they run before relying on them.

1. **Inventory first.** For each input file report: what it actually is (title, issuer,
   edition/year if printed on the pages), characters extracted, pages with no extractable
   text (scanned -> report only, do not OCR). Read `oisd-standards.txt` and state what it
   contains. Write `data/fine_tuning/SOURCES.md`: filename, real identity, how obtained
   ("downloaded from the web; file name suggests a mirror site, not the issuer"), licence
   = `UNKNOWN` unless printed in the document, and whether it is the standard itself or
   third-party material (the API 510 file appears to be a course study guide, not the API
   510 standard — say so if that is what it is). Issuer URL: `UNKNOWN — human to fill`.
2. **Section extraction** -> `data/fine_tuning/processed/<doc>.jsonl` with
   `{section_id, doc, heading, page_start, page_end, text}`. Strip headers, footers, page
   numbers.
3. **Split at section level** (80/10/10 train/val/test, fixed seed) so chunks of the same
   section never straddle splits. Write `data/fine_tuning/splits.json` (section ids per
   split) and `scripts/check_leakage.py` that fails if any section id appears in more than
   one split or any test text span of >= 200 characters appears in train. Paste counts.
4. **Instruction data** from TRAIN sections only -> Alpaca JSONL. Generate QA with the
   local gateway (env `OPENAI_BASE_URL`, `OPENAI_API_KEY`, model `auto`), at most 300
   pairs, back off >= 10 s on HTTP 429, abort after 20 consecutive failures. Each pair
   stores `source_section_id` and `evidence` (a verbatim quote <= 300 chars from that
   section). **Drop** a pair if `evidence` is not a verbatim substring of the section or if
   any number in the answer is absent from the section. Report kept/dropped counts.
5. **Statement-verification sets** (the source of precision/recall/F1). From numeric
   sentences (numbers with units/limits): TRUE = sentence as written; FALSE = same sentence
   with one number altered (x2, x0.5, or +/- one step) where the altered number does not
   appear elsewhere in that section. Balanced 50/50. Prompt format: `Statement: ... Does
   this statement agree with <doc>? Answer "match" or "mismatch".` Build
   `train_verification.jsonl` from TRAIN sections (mixed into training data) and
   `test_verification.jsonl` from TEST sections only. Record `{id, statement, label,
   section_id, doc}`.
6. **Metrics** `scripts/eval_metrics.py`: input predictions JSONL `{id, pred}`; output
   confusion matrix, accuracy, precision, recall, F1 with positive class = `mismatch`, and
   macro-F1. Precision = TP/(TP+FP), Recall = TP/(TP+FN), F1 = 2PR/(P+R), Accuracy =
   (TP+TN)/N. Unit test with a small hand-computed example (write the expected numbers as
   literals).
7. **Runner** `scripts/run_eval.py` with `--base-url`, `--model`, `--input`, `--output`;
   verify with the mock client only. Real base-vs-LoRA runs need GPU hardware: mark `NOT RUN`.
8. **LoRA script** `scripts/train_lora.py` (QLoRA: 4-bit base + LoRA adapters via
   transformers/peft/trl). It cannot run here: verify only with `py_compile` and a
   `--dry-run` that prints the resolved config. Header comment: `UNTESTED — requires GPU`.
9. Update `data/fine_tuning/README.md` with the run order. Do not `git add` anything.

### dev1.design
1. **Self-audit first.** For `/analytics`, `/audit`, `/models-breakdown`: list the route
   file, the component files, and paste a `curl` of each backend endpoint they call
   (status + first 300 chars). State plainly anything not working.
2. **Login OTP flow** in `frontend/src/routes/login.tsx` per §1.1: password step ->
   `mfa_required` shows a 6-digit code input (with a "use backup code" option) ->
   `enrollment_required` shows the QR (rendered from `qr_png_base64`) and backup codes
   once, then a confirm-code step. Handle 401 `invalid_code` and 429 `locked` (show
   `retry_after_s`).
3. **Monthly report UI:** a month picker, on-screen totals/by-model/daily tables from the
   JSON response, and a Download .docx button (admin only). Handle `null` as "not
   recorded", never 0.
4. **Audit page:** a chain-integrity badge from `GET /api/audit/verify` (valid / invalid at
   seq N / legacy entries count).
5. Air-gap rules: no external fonts, CDNs, analytics, or QR services; the QR comes only
   from the server's base64 PNG.
6. If a backend endpoint is not live yet, code against the contract using a clearly named
   mock module under `frontend/src/lib/mocks/`, switched by an env flag. Report which
   screens still run on mocks; never leave mocks silently on.
7. Verify with a production build and an SSR `curl`; paste the output.

### rev1.r1 (security review — reviews dev1.impl and orch1.peer)
Do not trust the implementers' reports; attack the running code.
- Auth: replay the same TOTP code twice; 6 wrong codes; an expired `mfa_token`; an
  `enroll_token` against a normal endpoint; a backup code twice; grep the repo for the old
  hardcoded secret; confirm secrets/codes/tokens never appear in logs or `PROGRESS.md`;
  confirm `data/.jwt_secret` is mode 0600 and git-ignored.
- Audit chain: tamper with a copy of the log (edit, delete, reorder, truncate the tail) and
  confirm detection; confirm no writer bypasses the chained appender.
- Report findings with file:line and the exact command/output. A clean review need not
  invent findings.

### rev1.r2 (data + report review — reviews dev1.qa and dev1.impl's report work)
- Data: independently re-derive the split from `splits.json` and confirm no leakage; pull
  20 random QA pairs and check each `evidence` against its section; sample 20 FALSE
  statements and confirm each differs from the source only in the altered number; recompute
  the metrics unit-test example by hand.
- Report backend: build a synthetic log with known answers, request the report, and compare
  every number; confirm unrecorded fields are `null`.
- Confirm `SOURCES.md` does not assert an issuer, licence, or URL the files themselves do
  not support.

---

## 4. Acceptance checklist (orch1.lead runs; report failures verbatim)

```
backend/.venv/bin/python -m pytest backend -q
backend/.venv/bin/python -m backend.tools.verify_audit_chain
backend/.venv/bin/python data/fine_tuning/scripts/check_leakage.py
backend/.venv/bin/python -m pytest data/fine_tuning -q
grep -rn "lex-sovereign-workbench-secret-key-change-in-prod" backend/ frontend/src/ || echo "none found"
git --no-pager status --short
```
Then: one full login (password + TOTP) -> submit a task -> confirm the audit chain still
verifies and the monthly report counts the task.
