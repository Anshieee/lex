# Independent Review Report — Round 2 Closeout (rev1-r2)

**Reviewer:** rev1-r2 (Independent Reviewer)  
**Date:** 2026-09-29  
**Rig:** product-team  
**Review Boundary:** dev1.qa fine-tuning data pipeline + dev1.impl monthly report backend

---

## Executive Summary

| Work Area | Status | Summary |
|-----------|--------|---------|
| **Fine-tuning Data Pipeline (dev1.qa)** | **FAIL — Not Done** | **Zero** of 7 required deliverables exist. Only input PDFs, extracted text, eval_prompts.json, and helper scripts are present. |
| **Monthly Report Backend (dev1.impl)** | **PASS** | All contract requirements met. JSON & DOCX responses verified against audit log; figures match independent computation. |
| **Audit Chain (orch1.peer)** | **PASS** | CLI & endpoint verify integrity. Tamper detection works for edit/delete/reorder. Legacy entries counted. |
| **Auth MFA (dev1.impl)** | **PASS** | All security tests pass: replay protection, lockout, expired tokens, scope isolation, no hardcoded secrets. |

---

## 1. Fine-Tuning Data Pipeline — dev1.qa

**Contract Reference:** `docs/dispatch/round2-tasks.md` §3 (dev1.qa section) — 9 steps

### Required Outputs vs. Actual State

| # | Contract Requirement | Expected Output | Actual State | Evidence |
|---|----------------------|-----------------|--------------|----------|
| 1 | Inventory of inputs | `data/fine_tuning/SOURCES.md` | ❌ **NOT FOUND** | Only `README.md` (template) exists |
| 2 | Section extraction | `data/fine_tuning/processed/<doc>.jsonl` | ❌ **NOT FOUND** | No `processed/` directory |
| 3 | Section-level splits (80/10/10) | `splits.json` + `check_leakage.py` | ❌ **NOT FOUND** | Neither file exists |
| 4 | Instruction data (Alpaca) | `train.jsonl` / `val.jsonl` | ❌ **NOT FOUND** | Neither file exists |
| 5 | Statement-verification sets | `train_verification.jsonl` + `test_verification.jsonl` | ❌ **NOT FOUND** | Neither file exists |
| 6 | Metrics scripts | `eval_metrics.py`, `run_eval.py` | ❌ **NOT FOUND** | Neither file exists |
| 7 | LoRA script | `train_lora.py` (verify-only) | ❌ **NOT FOUND** | File not present |
| 8 | Updated README with run order | `README.md` updated | ⚠️ **PARTIAL** | Template exists but not updated with actual run order |
| — | Evaluation prompts | `eval_prompts.json` | ✅ **EXISTS** | 20 prompts, valid JSON |

### Files Actually Present in `data/fine_tuning/`

```
data/fine_tuning/
├── README.md                 # Template/instructions (5289 bytes)
├── eval_prompts.json         # 20 evaluation prompts (7233 bytes) ✓
├── raw/
│   ├── *.pdf (4 files)       # Original downloaded PDFs
│   └── extracted/
│       └── *_extracted.txt   # PyMuPDF extractions (4 files) ✓ step 1 output
└── scripts/
    ├── extract_text.py       # Step 1 script
    ├── generate_qa.py        # Step 2 script (requires 70B+ LLM gateway)
    └── convert_format.py     # Step 3 script
```

### Assessment

**The fine-tuning data pipeline has not been executed.** The contract required dev1.qa to:
1. Run `extract_text.py` → produce section-structured JSONL
2. Split at section level → produce `splits.json` and `check_leakage.py`
3. Run `generate_qa.py` against TRAIN sections (requires LLM gateway — marked NOT RUN per rules)
4. Run `convert_format.py` → produce `train.jsonl`/`val.jsonl`
5. Generate verification sets → `test_verification.jsonl`
6. Write metrics and runner scripts
7. Write LoRA script (verify-only)
8. Update README with actual run order

**None of steps 2–8 were performed.** The raw extractions (step 1) are the only pipeline output.

### Blocker for Round 3 / Colab

Per overnight-run.md §1 priority #6: "Fine-tuning DATA is fully prepared: SOURCES.md, cleaned sections, leakage-checked splits, train.jsonl/val.jsonl/test.jsonl, test_verification.jsonl — everything needed to open Colab tomorrow and just start training, no data work left."

**This blocker is NOT satisfied.** The data work is at ~10% completion (only raw extraction done).

---

## 2. Monthly Report Backend — dev1.impl

**Contract Reference:** `docs/contracts/reports.md` (`GET /api/reports/monthly`)

### Endpoint Verification

| Test | Result | Evidence |
|------|--------|----------|
| `GET /api/reports/monthly?month=2026-09&format=json` (admin) | ✅ 200 | Returns full schema |
| `GET /api/reports/monthly?month=2026-09&format=docx` (admin) | ✅ 200 | Valid DOCX, correct Content-Type |
| `GET /api/reports/monthly?month=2026-09` (no auth) | ✅ 401 | "Not authenticated" |
| `GET /api/reports/monthly?month=2026-09` (operator token) | ✅ 403 | "Admin access required" |
| `GET /api/reports/monthly?month=09-2026` (admin) | ✅ 400 | Invalid month format |
| `GET /api/reports/monthly?month=2026-01` (admin, empty month) | ✅ 200 | Zeros/nulls, not errors |

### JSON Schema Compliance

```json
{
  "month": "2026-09",
  "generated_at": "2026-09-29T00:08:20.757926+00:00",
  "source_log": "/home/sandbox/workspace/data/audit_log.jsonl",
  "entries_in_month": 293,
  "totals": {
    "tasks": 31,
    "completed": 31,
    "failed": 0,
    "success_rate": 1.0,
    "approvals": 32,
    "rejections": 0
  },
  "by_model": [...],
  "by_task_type": [...],
  "daily": [...],
  "egress": {"outbound_connections": null, "source": "audit_log (not recorded)"}
}
```

✅ All required fields present  
✅ `success_rate` as fraction 0-1 (not percentage)  
✅ Unrecorded fields are `null` (input_tokens, output_tokens, egress.outbound_connections)  
✅ Month with no entries returns zeros/nulls

### Independent Figure Verification

Computed independently from `data/audit_log.jsonl` (293 September entries):

| Metric | API Response | Independent Computation | Match |
|--------|--------------|------------------------|-------|
| Tasks (task_submitted) | 31 | 31 | ✅ |
| Completed | 31 | 31 | ✅ |
| Failed | 0 | 0 | ✅ |
| Success rate | 1.0 | 1.0 | ✅ |
| Approvals | 32 | 32 | ✅ |
| Rejections | 0 | 0 | ✅ |
| qwen2.5:7b requests | 23 | 23 | ✅ |
| moondream requests | 37 | 37 | ✅ |
| qwen2.5:7b-instruct-q4_K_M requests | 85 | 85 | ✅ |
| qwen2.5-coder:7b-instruct-q4_K_M requests | 20 | 20 | ✅ |
| test-model requests | 1 | 1 | ✅ |
| Daily Sep 11 tasks | 11 | 11 | ✅ |
| Daily Sep 27 tasks | 3 | 3 | ✅ |
| Daily Sep 28 tasks | 14 | 14 | ✅ |
| Daily Sep 29 tasks | 3 | 3 | ✅ |

**All figures verified.** No discrepancies found.

### DOCX Output Verification

| Check | Result |
|-------|--------|
| `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` | ✅ |
| Valid ZIP container (`python -m zipfile -l`) | ✅ |
| Required parts: `[Content_Types].xml`, `word/document.xml`, `word/_rels/document.xml.rels` | ✅ |
| Tables: Summary, By Model, By Task Type, Daily Breakdown, Egress | ✅ |
| Null fields render as "Not recorded" (not 0) | ✅ |
| File size: 37,644 bytes | ✅ |

---

## 3. Audit Chain — orch1.peer

**Contract Reference:** `docs/contracts/audit-chain.md`

### CLI Verification

```bash
$ backend/.venv/bin/python -m backend.tools.verify_audit_chain
Valid: True
Entries checked: 136
First invalid seq: None
Chain start seq: 1
Legacy unhashed entries: 157
Exit code: 0  ✅
```

### Endpoint Verification

```bash
$ GET /api/audit/verify (admin)
{
  "valid": true,
  "entries_checked": 136,
  "first_invalid_seq": null,
  "chain_start_seq": 1,
  "legacy_unhashed_entries": 157
}
```

✅ Admin auth required (401 without token, 403 for non-admin)  
✅ All contract fields present  
✅ Values match CLI output

### Tamper Detection Tests (on copy of log)

| Tamper Type | Detection | First Invalid Seq |
|-------------|-----------|-------------------|
| Edit field in middle entry | ✅ Detected | 10 |
| Delete middle line | ✅ Detected | gap in seq |
| Reorder two lines | ✅ Detected | seq mismatch |
| Truncate tail | ✅ Detected (via verify_chain) | N/A |

### Writers to Audit Log — All Use Chained Appender

| Writer Location | Uses |
|-----------------|------|
| `backend/agent/agent_graph.py` (planner, execute_tool, synthesize) | `log_step()` → `log_step_chained()` ✅ |
| `backend/main.py` (auth, task endpoints) | `log_step()` → `log_step_chained()` ✅ |
| `backend/tools/audit_logger.py` | Delegates to `log_step_chained()` ✅ |

**No writer bypasses the chained appender.** File locking via `fcntl.flock` serializes concurrent appends.

### Unit Tests — All Pass (10/10)

- Empty log → valid
- Missing log → valid
- Single entry chain → valid
- Multiple entries → valid
- Legacy entries counted not failed
- Edit field → detected
- Delete line → detected
- Reorder lines → detected
- 50 concurrent appends → valid chain
- Chain start seq = 1 after legacy entries

---

## 4. Auth MFA — dev1.impl

**Contract Reference:** `docs/contracts/auth.md`

### Security Test Results (per rev1.r1 assignment + independent verification)

| Attack Vector | Expected | Actual | Status |
|---------------|----------|--------|--------|
| Replay TOTP code twice | 2nd rejected | 2nd → 401 `invalid_code` | ✅ |
| 6 wrong codes | 429 lockout (5 min) | 5th wrong → 401, 6th → 429 locked | ✅ |
| Expired `mfa_token` (10 min ago) | 401 `expired_mfa_token` | 401 `{"detail":"expired_mfa_token"}` | ✅ |
| Expired `enroll_token` (20 min ago) | 401 | 401 `Invalid or expired enrollment token` | ✅ |
| `enroll_token` on `/api/auth/mfa/verify` | 401 | 401 `invalid_code` (scope mismatch) | ✅ |
| `mfa_token` on `/api/auth/totp/enroll` | 401 | 401 `Invalid or expired enrollment token` | ✅ |
| Backup code used twice | 2nd rejected | Unit test passes (single-use) | ✅ |

### Secret Hygiene

| Check | Result |
|-------|--------|
| Hardcoded secret `lex-sovereign-workbench-secret-key-change-in-prod` in backend/ | ❌ **NOT FOUND** (only in test file as search target) |
| `data/.jwt_secret` mode 0600 | ✅ `-rw-------` |
| `data/.jwt_secret` in `.gitignore` | ✅ Only `data/audit_log.jsonl` shows modified |
| Secrets/codes/tokens in audit log | ✅ None found (grep for secret/token/code/password) |
| Secrets/codes/tokens in PROGRESS.md | ✅ None found |

### Route Conflict (rev1.r1 Finding)

rev1.r1 reported: "main.py still defines old `/api/auth/login` that shadows auth_mfa router."

**Current state:** The old endpoint in `main.py` lines 97–114 is **COMMENTED OUT** with a note: "NOTE: /api/auth/login is now handled by auth_mfa.router". The auth_mfa router is included at line 63. **No route conflict exists in running code.**

---

## 5. Test Suite Status

```bash
$ backend/.venv/bin/python -m pytest backend/tests/ -q
41 passed, 2 warnings in 30.08s
```

| Test Module | Tests | Status |
|-------------|-------|--------|
| `test_audit_chain.py` | 10 | ✅ All pass |
| `test_auth_mfa.py` | 17 | ✅ All pass |
| `test_reports.py` | 14 | ✅ All pass |

---

## 6. Severity Classification

| Severity | Count | Items |
|----------|-------|-------|
| **MUST-FIX (P0)** | 1 | Fine-tuning data pipeline not executed (blocks Colab) |
| **HIGH** | 0 | — |
| **MEDIUM** | 0 | — |
| **LOW** | 1 | README.md not updated with actual run order |
| **INFO** | 1 | Route conflict reported by rev1-r1 already fixed (old endpoint commented out) |

---

## 7. Recommended Priority Order

| Priority | Issue | Effort | Owner |
|----------|-------|--------|-------|
| **P0** | Execute fine-tuning pipeline steps 2–8: section extraction, splits, leakage check, train/val generation, verification sets, metrics scripts, LoRA script, README update | High (requires LLM gateway for QA generation) | dev1.qa |
| **P1** | Verify `check_leakage.py` works against generated splits | Medium | dev1.qa |
| **P2** | Update `README.md` with actual run order and artifact locations | Low | dev1.qa |

---

## 8. Files Reviewed (Source-Backed)

**Fine-Tuning:**
- `data/fine_tuning/` (directory listing)
- `data/fine_tuning/README.md`
- `data/fine_tuning/eval_prompts.json`
- `data/fine_tuning/raw/extracted/*.txt`
- `data/fine_tuning/scripts/*.py`
- `docs/fine-tune/` (source PDFs)

**Monthly Report:**
- `backend/reports.py`
- `backend/tests/test_reports.py`
- `backend/tools/audit_logger.py`
- `backend/tools/audit_config.py`
- `backend/tools/audit_chain.py`
- `backend/tools/verify_audit_chain.py`
- `data/audit_log.jsonl`

**Auth MFA:**
- `backend/auth_mfa.py`
- `backend/auth.py`
- `backend/main.py` (auth routes)
- `backend/tests/test_auth_mfa.py`
- `data/users.db`, `data/.jwt_secret`

---

## Verdict

### Fine-Tuning Data Pipeline (dev1.qa): **FAIL — NOT DONE**
Zero of the 7 required deliverables produced. This blocks Round 3 priority #6 (Colab readiness) and must be completed before any training can begin.

### Monthly Report Backend (dev1.impl): **PASS**
All contract requirements satisfied. JSON and DOCX responses independently verified against audit log. No discrepancies.

### Audit Chain (orch1.peer): **PASS**
Tamper-evident chain verified. CLI and endpoint both functional. All unit tests pass.

### Auth MFA (dev1.impl): **PASS**
All security requirements met. Replay protection, lockout, token scopes, and secret hygiene verified.

---

**Review conducted by:** rev1-r2 (Codex)  
**Method:** Independent source verification, live API testing, audit log computation, tamper tests, security attack scenarios  
**Scope:** Full backend implementation as of 2026-09-29

