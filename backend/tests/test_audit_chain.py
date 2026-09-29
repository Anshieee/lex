# backend/tests/test_audit_chain.py
"""
Tests for audit chain integrity verification.
"""
import json
import os
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.tools.audit_chain import log_step_chained, verify_chain
from backend.tools.audit_config import LOG_PATH


@pytest.fixture
def temp_log():
    """Create a temporary log file for testing."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
        temp_path = f.name
    
    # Override LOG_PATH for this test
    import backend.tools.audit_config as audit_config
    import backend.tools.audit_chain as audit_chain
    original_path = audit_config.LOG_PATH
    audit_config.LOG_PATH = temp_path
    audit_chain.LOG_PATH = temp_path
    
    yield temp_path
    
    # Cleanup
    if os.path.exists(temp_path):
        os.unlink(temp_path)
    audit_config.LOG_PATH = original_path
    audit_chain.LOG_PATH = original_path


def test_empty_log_valid(temp_log):
    """Empty log should be valid with 0 entries checked."""
    result = verify_chain(temp_log)
    assert result["valid"] is True
    assert result["entries_checked"] == 0
    assert result["first_invalid_seq"] is None
    assert result["chain_start_seq"] is None
    assert result["legacy_unhashed_entries"] == 0


def test_missing_log_valid(temp_log):
    """Missing log file should be valid."""
    os.unlink(temp_log)
    result = verify_chain(temp_log)
    assert result["valid"] is True
    assert result["entries_checked"] == 0


def test_single_entry_chain(temp_log):
    """Single chained entry should verify correctly."""
    entry = log_step_chained(
        task_id="test-1",
        step_type="test_step",
        model_used="test-model",
        duration_ms=100.0,
        input_summary="test input",
        output_summary="test output",
        status="success",
        user="testuser",
    )
    
    assert "seq" in entry
    assert "prev_hash" in entry
    assert "hash" in entry
    assert entry["seq"] == 1
    assert entry["prev_hash"] == "0" * 64
    
    result = verify_chain(temp_log)
    assert result["valid"] is True
    assert result["entries_checked"] == 1
    assert result["first_invalid_seq"] is None
    assert result["chain_start_seq"] == 1
    assert result["legacy_unhashed_entries"] == 0


def test_multiple_entries_chain(temp_log):
    """Multiple chained entries should form a valid chain."""
    for i in range(5):
        log_step_chained(
            task_id=f"test-{i}",
            step_type="test_step",
            duration_ms=float(i * 10),
            status="success",
        )
    
    result = verify_chain(temp_log)
    assert result["valid"] is True
    assert result["entries_checked"] == 5
    assert result["chain_start_seq"] == 1


def test_legacy_entries_counted_not_failed(temp_log):
    """Legacy unhashed entries should be counted but not fail verification."""
    # Write some legacy entries (no chain fields)
    with open(temp_log, "w") as f:
        for i in range(3):
            f.write(json.dumps({
                "timestamp": "2026-01-01T00:00:00+00:00",
                "task_id": f"legacy-{i}",
                "step_type": "legacy",
                "status": "success",
            }) + "\n")
    
    # Add chained entries
    for i in range(3):
        log_step_chained(task_id=f"chained-{i}", step_type="chained", status="success")
    
    result = verify_chain(temp_log)
    assert result["valid"] is True
    assert result["entries_checked"] == 3
    assert result["legacy_unhashed_entries"] == 3
    assert result["chain_start_seq"] == 1


def test_tamper_detection_edit_field(temp_log):
    """Editing a field in a chained entry should be detected."""
    log_step_chained(task_id="test-1", step_type="test", status="success")
    log_step_chained(task_id="test-2", step_type="test", status="success")
    
    # Tamper: modify the first entry's status
    with open(temp_log, "r") as f:
        lines = f.readlines()
    
    entry1 = json.loads(lines[0])
    entry1["status"] = "tampered"
    lines[0] = json.dumps(entry1) + "\n"
    
    with open(temp_log, "w") as f:
        f.writelines(lines)
    
    result = verify_chain(temp_log)
    assert result["valid"] is False
    assert result["first_invalid_seq"] == 1


def test_tamper_detection_delete_line(temp_log):
    """Deleting a line from the chain should be detected."""
    log_step_chained(task_id="test-1", step_type="test", status="success")
    log_step_chained(task_id="test-2", step_type="test", status="success")
    log_step_chained(task_id="test-3", step_type="test", status="success")
    
    # Tamper: delete middle line
    with open(temp_log, "r") as f:
        lines = f.readlines()
    
    lines.pop(1)  # Remove second entry
    
    with open(temp_log, "w") as f:
        f.writelines(lines)
    
    result = verify_chain(temp_log)
    assert result["valid"] is False
    # The seq check should catch the gap
    assert result["first_invalid_seq"] is not None


def test_tamper_detection_reorder_lines(temp_log):
    """Reordering two lines should be detected."""
    log_step_chained(task_id="test-1", step_type="test", status="success")
    log_step_chained(task_id="test-2", step_type="test", status="success")
    
    # Tamper: swap lines
    with open(temp_log, "r") as f:
        lines = f.readlines()
    
    lines[0], lines[1] = lines[1], lines[0]
    
    with open(temp_log, "w") as f:
        f.writelines(lines)
    
    result = verify_chain(temp_log)
    assert result["valid"] is False
    assert result["first_invalid_seq"] is not None


def test_concurrent_appends_valid_chain(temp_log):
    """50 concurrent appends should produce a valid chain."""
    def append_entry(i):
        log_step_chained(
            task_id=f"concurrent-{i}",
            step_type="concurrent_test",
            duration_ms=float(i),
            status="success",
        )
        time.sleep(0.001)  # Small delay to increase contention
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(append_entry, i) for i in range(50)]
        for f in futures:
            f.result()
    
    result = verify_chain(temp_log)
    assert result["valid"] is True
    assert result["entries_checked"] == 50


def test_chain_start_entry():
    """Verify that a chain_start entry is created when hashing begins."""
    # This test would verify the chain_start event if we implement it
    # For now, chain_start_seq is the seq of the first chained entry
    with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
        temp_path = f.name
    
    import backend.tools.audit_config as audit_config
    import backend.tools.audit_chain as audit_chain
    original_path = audit_config.LOG_PATH
    audit_config.LOG_PATH = temp_path
    audit_chain.LOG_PATH = temp_path
    
    try:
        # Write legacy entries
        with open(temp_path, "w") as f:
            for i in range(2):
                f.write(json.dumps({
                    "timestamp": "2026-01-01T00:00:00+00:00",
                    "task_id": f"legacy-{i}",
                    "step_type": "legacy",
                    "status": "success",
                }) + "\n")
        
        # Add first chained entry
        entry = log_step_chained(task_id="first-chained", step_type="test", status="success")
        
        result = verify_chain(temp_path)
        assert result["chain_start_seq"] == 1  # First chained entry has seq=1
        assert result["legacy_unhashed_entries"] == 2
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        audit_config.LOG_PATH = original_path
        audit_chain.LOG_PATH = original_path


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
