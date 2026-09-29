# Audit chain — tamper-evident audit log

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