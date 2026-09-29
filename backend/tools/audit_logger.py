# backend/tools/audit_logger.py
"""
Structured JSON audit logger for every agent step.
Writes to data/audit_log.jsonl (append-only).
All data stays on-premise — no external logging services.
"""
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# Import chained logger
from backend.tools.audit_chain import log_step_chained, verify_chain

# Shared config
from backend.tools.audit_config import LOG_PATH


def _ensure_log_dir():
    os.makedirs(os.path.dirname(LOG_PATH) or ".", exist_ok=True)


def log_step(
    task_id: str,
    step_type: str,
    model_used: str = "",
    duration_ms: float = 0,
    input_summary: str = "",
    output_summary: str = "",
    status: str = "success",
    user: str = "",
    extra: Optional[Dict[str, Any]] = None,
):
    """Append a structured audit entry to the JSONL log file (now chained)."""
    # Delegate to chained implementation
    log_step_chained(
        task_id=task_id,
        step_type=step_type,
        model_used=model_used,
        duration_ms=duration_ms,
        input_summary=input_summary,
        output_summary=output_summary,
        status=status,
        user=user,
        extra=extra,
    )


def get_recent_entries(n: int = 50) -> list:
    """Return the last N audit log entries."""
    if not os.path.exists(LOG_PATH):
        return []
    entries = []
    with open(LOG_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return entries[-n:]


def get_log_path() -> str:
    """Return the absolute path to the log file for downloads."""
    return os.path.abspath(LOG_PATH)


# Re-export verify_chain for the CLI and route
__all__ = [
    "LOG_PATH",
    "log_step",
    "get_recent_entries",
    "get_log_path",
    "verify_chain",
]
