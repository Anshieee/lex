# backend/tools/audit_chain.py
"""
Tamper-evident audit chain implementation.
Each entry gains seq, prev_hash, and hash = HMAC-SHA256(key, prev_hash + canonical_json(entry without hash)).
"""
import fcntl
import hashlib
import hmac
import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.tools.audit_config import LOG_PATH, AUDIT_KEY_ENV, JWT_SECRET_ENV, JWT_SECRET_FILE

# File lock for serialized appends
_append_lock = threading.Lock()


def _get_audit_hmac_key() -> bytes:
    """Get HMAC key from env or derive from JWT secret with distinct label."""
    key_env = os.environ.get(AUDIT_KEY_ENV)
    if key_env:
        return key_env.encode("utf-8")
    
    # Fallback: derive from JWT secret
    jwt_secret = os.environ.get(JWT_SECRET_ENV)
    if not jwt_secret:
        # Read from persisted file
        if os.path.exists(JWT_SECRET_FILE):
            with open(JWT_SECRET_FILE, "r") as f:
                jwt_secret = f.read().strip()
        else:
            # Generate and persist
            import secrets
            jwt_secret = secrets.token_hex(32)
            os.makedirs(os.path.dirname(JWT_SECRET_FILE) or ".", exist_ok=True)
            with open(JWT_SECRET_FILE, "w") as f:
                f.write(jwt_secret)
            os.chmod(JWT_SECRET_FILE, 0o600)
    
    # Derive with distinct label
    return hmac.new(
        jwt_secret.encode("utf-8"),
        b"lex-audit-chain-v1",
        hashlib.sha256
    ).digest()


def _canonical_json(obj: Dict[str, Any]) -> str:
    """Canonical JSON: sorted keys, no whitespace."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def _compute_hash(prev_hash: str, entry: Dict[str, Any], key: bytes) -> str:
    """Compute HMAC-SHA256(prev_hash + canonical_json(entry without hash))."""
    # Create copy without hash field
    entry_copy = {k: v for k, v in entry.items() if k != "hash"}
    canonical = _canonical_json(entry_copy)
    message = prev_hash + canonical
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).hexdigest()


def _read_last_entry() -> Optional[Dict[str, Any]]:
    """Read the last entry from the audit log."""
    if not os.path.exists(LOG_PATH):
        return None
    with open(LOG_PATH, "r") as f:
        lines = f.readlines()
    if not lines:
        return None
    # Find last valid JSON line
    for line in reversed(lines):
        line = line.strip()
        if line:
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    return None


def _get_next_seq() -> int:
    """Get next sequence number from last entry."""
    last = _read_last_entry()
    if last and "seq" in last:
        return last["seq"] + 1
    return 1


def _get_prev_hash() -> str:
    """Get prev_hash from last entry, or genesis (64 zeros)."""
    last = _read_last_entry()
    if last and "hash" in last:
        return last["hash"]
    return "0" * 64


def log_step_chained(
    task_id: str,
    step_type: str,
    model_used: str = "",
    duration_ms: float = 0,
    input_summary: str = "",
    output_summary: str = "",
    status: str = "success",
    user: str = "",
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Append a chained audit entry with file locking.
    Returns the full entry including seq, prev_hash, hash.
    """
    # Build base entry (without chain fields)
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "task_id": task_id,
        "step_type": step_type,
        "model_used": model_used,
        "duration_ms": round(duration_ms, 1),
        "input_summary": input_summary[:500],
        "output_summary": output_summary[:500],
        "status": status,
        "user": user,
    }
    if extra:
        entry["extra"] = extra
    
    # Serialize appends with file lock
    key = _get_audit_hmac_key()
    
    with _append_lock:
        # Also use fcntl flock for cross-process safety
        with open(LOG_PATH, "a") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                # Re-read last entry in case another process wrote
                seq = _get_next_seq()
                prev_hash = _get_prev_hash()
                
                # Add chain fields
                entry["seq"] = seq
                entry["prev_hash"] = prev_hash
                entry["hash"] = _compute_hash(prev_hash, entry, key)
                
                # Write
                f.write(_canonical_json(entry) + "\n")
                f.flush()
                os.fsync(f.fileno())
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    
    return entry


def verify_chain(log_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Verify the audit chain integrity.
    Returns: {valid, entries_checked, first_invalid_seq, chain_start_seq, legacy_unhashed_entries}
    """
    path = log_path or LOG_PATH
    
    if not os.path.exists(path):
        return {
            "valid": True,
            "entries_checked": 0,
            "first_invalid_seq": None,
            "chain_start_seq": None,
            "legacy_unhashed_entries": 0
        }
    
    key = _get_audit_hmac_key()
    entries_checked = 0
    legacy_unhashed = 0
    chain_start_seq = None
    first_invalid_seq = None
    expected_prev_hash = "0" * 64
    
    with open(path, "r") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            
            has_chain = "seq" in entry and "prev_hash" in entry and "hash" in entry
            
            if not has_chain:
                legacy_unhashed += 1
                continue
            
            # This is a chained entry
            if chain_start_seq is None:
                chain_start_seq = entry["seq"]
            
            # Verify seq is sequential (entries_checked only counts chained entries)
            expected_seq = entries_checked + 1
            if entry["seq"] != expected_seq:
                if first_invalid_seq is None:
                    first_invalid_seq = entry["seq"]
            
            # Verify prev_hash
            if entry["prev_hash"] != expected_prev_hash:
                if first_invalid_seq is None:
                    first_invalid_seq = entry["seq"]
            
            # Verify hash
            computed_hash = _compute_hash(entry["prev_hash"], entry, key)
            if computed_hash != entry["hash"]:
                if first_invalid_seq is None:
                    first_invalid_seq = entry["seq"]
            
            expected_prev_hash = entry["hash"]
            entries_checked += 1
    
    return {
        "valid": first_invalid_seq is None,
        "entries_checked": entries_checked,
        "first_invalid_seq": first_invalid_seq,
        "chain_start_seq": chain_start_seq,
        "legacy_unhashed_entries": legacy_unhashed
    }
