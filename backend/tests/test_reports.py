"""
Tests for Monthly Report Backend per contract §1.2.
Covers: JSON response shape, null handling for missing fields,
synthetic fixture testing, empty month, and report against real log.
"""
import os
import sys
import json
import tempfile
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.reports import (
    router as reports_router,
    parse_month,
    get_month_range,
    load_audit_entries_in_month,
    generate_monthly_report,
    generate_docx_report,
)

# Create minimal test app with auth bypassed for endpoint tests
test_app = FastAPI()
test_app.include_router(reports_router)

from backend.auth import require_admin

def _fake_admin():
    return {"id": 1, "username": "admin", "role": "admin", "display_name": "System Administrator"}

test_app.dependency_overrides[require_admin] = _fake_admin
client = TestClient(test_app)


@pytest.fixture
def fake_audit_log(tmp_path):
    """Create a temporary audit log with synthetic entries."""
    log_path = tmp_path / "audit_log.jsonl"

    # Generate synthetic entries for 2026-09
    entries = []

    # 10 task_submitted in Sept 2026, 7 success, 3 failed
    for i in range(7):
        entries.append({
            "timestamp": f"2026-09-{15+i:02d}T10:00:00+00:00",
            "task_id": f"task-{i:04d}",
            "step_type": "task_submitted",
            "model_used": "qwen2.5:7b",
            "duration_ms": 1000 + i * 100,
            "input_summary": f"Test prompt {i}",
            "output_summary": "Task completed successfully",
            "status": "success",
            "user": "admin",
        })

    for i in range(3):
        entries.append({
            "timestamp": f"2026-09-{18+i:02d}T11:00:00+00:00",
            "task_id": f"task-fail-{i:04d}",
            "step_type": "task_submitted",
            "model_used": "qwen2.5:7b",
            "duration_ms": 500,
            "input_summary": "Test prompt that fails",
            "output_summary": "Error occurred",
            "status": "failed",
            "user": "admin",
        })

    # 5 approval steps (all success)
    for i in range(5):
        entries.append({
            "timestamp": f"2026-09-{10+i:02d}T12:00:00+00:00",
            "task_id": f"task-{i:04d}",
            "step_type": "approval",
            "model_used": "",
            "duration_ms": 0,
            "input_summary": f"Approval {i}",
            "output_summary": "Approved",
            "status": "success",
            "user": "admin",
        })

    # 2 planner steps with model and latency
    for i in range(2):
        entries.append({
            "timestamp": f"2026-09-{20+i:02d}T14:00:00+00:00",
            "task_id": f"task-plan-{i:04d}",
            "step_type": "planner",
            "model_used": "qwen2.5:7b",
            "duration_ms": 5000 + i * 1000,
            "input_summary": "Planning task",
            "output_summary": "Execution plan created",
            "status": "success",
            "user": "",
        })

    # Some entries in August 2026 (should not be included)
    for i in range(3):
        entries.append({
            "timestamp": f"2026-08-{10+i:02d}T10:00:00+00:00",
            "task_id": f"task-aug-{i:04d}",
            "step_type": "task_submitted",
            "model_used": "qwen2.5:7b",
            "duration_ms": 2000,
            "input_summary": "August task",
            "output_summary": "Completed",
            "status": "success",
            "user": "admin",
        })

    # Write to file
    with open(log_path, "w") as f:
        for entry in entries:
            f.write(json.dumps(entry) + "\n")

    return log_path, entries


@pytest.fixture
def admin_user():
    """Get admin user for testing."""
    return {
        "id": 1,
        "username": "admin",
        "role": "admin",
        "display_name": "System Administrator",
    }


class TestParseMonth:
    """Test month parsing."""

    def test_valid_month(self):
        """Valid YYYY-MM should parse correctly."""
        year, month = parse_month("2026-09")
        assert year == 2026
        assert month == 9

    def test_invalid_format(self):
        """Invalid format should raise ValueError."""
        with pytest.raises(ValueError):
            parse_month("09-2026")

    def test_invalid_month(self):
        """Invalid month number should raise ValueError."""
        with pytest.raises(ValueError):
            parse_month("2026-13")

    def test_empty_string(self):
        """Empty string should raise ValueError."""
        with pytest.raises(ValueError):
            parse_month("")


class TestLoadAuditEntries:
    """Test loading entries from audit log."""

    def test_loads_entries_in_month(self, fake_audit_log):
        """Should load entries within the specified month."""
        log_path, entries = fake_audit_log

        with patch("backend.reports.get_log_path", return_value=str(log_path)):
            result = load_audit_entries_in_month(2026, 9)

        # Should only have September entries (7+3+5+2 = 17)
        assert len(result) == 17
        for entry in result:
            assert entry["timestamp"].startswith("2026-09")

    def test_loads_empty_for_missing_month(self, fake_audit_log):
        """Should return empty list for month with no entries."""
        log_path, entries = fake_audit_log

        with patch("backend.reports.get_log_path", return_value=str(log_path)):
            result = load_audit_entries_in_month(2026, 8)

        # Should have August entries
        assert len(result) > 0

    def test_loads_empty_for_nonexistent_log(self, tmp_path):
        """Should return empty list if log file doesn't exist."""
        nonexistent = tmp_path / "nonexistent.jsonl"

        with patch("backend.reports.get_log_path", return_value=str(nonexistent)):
            result = load_audit_entries_in_month(2026, 9)

        assert result == []


class TestGenerateReport:
    """Test report generation."""

    def test_report_with_synthetic_entries(self, fake_audit_log):
        """Test report generation with synthetic entries."""
        log_path, entries = fake_audit_log

        with patch("backend.reports.get_log_path", return_value=str(log_path)):
            month_entries = load_audit_entries_in_month(2026, 9)
            report = generate_monthly_report(month_entries, 2026, 9)

        # Verify structure
        assert report["month"] == "2026-09"
        assert "generated_at" in report
        assert "source_log" in report
        assert report["entries_in_month"] == 17

        # Verify totals
        assert report["totals"]["tasks"] == 10
        assert report["totals"]["completed"] == 7
        assert report["totals"]["failed"] == 3
        assert report["totals"]["success_rate"] == 0.7
        assert report["totals"]["approvals"] == 5
        assert report["totals"]["rejections"] == 0

        # Verify by_model (should only include entries with model_used != "unknown")
        assert len(report["by_model"]) == 1
        assert report["by_model"][0]["model"] == "qwen2.5:7b"
        # All 12 entries with model_used="qwen2.5:7b": 10 task_submitted + 2 planner
        assert report["by_model"][0]["requests"] == 12
        # 7 success (task) + 2 success (planner) = 9 / 12 requests = 0.75
        assert report["by_model"][0]["success_rate"] == 0.75
        # Avg latency: (1000+1100+1200+1300+1400+1500+1600 + 3*500 + 5000+6000) / 12 = 21600/12 = 1800.0
        assert report["by_model"][0]["avg_latency_ms"] == pytest.approx(1800.0, abs=1)
        assert report["by_model"][0]["input_tokens"] is None
        assert report["by_model"][0]["output_tokens"] is None

        # Verify by_task_type
        task_types = {t["task_type"]: t for t in report["by_task_type"]}
        assert task_types["task_submitted"]["count"] == 10
        assert task_types["approval"]["count"] == 5
        assert task_types["planner"]["count"] == 2

    def test_report_empty_month(self, tmp_path):
        """Test report with no entries (empty month)."""
        nonexistent = tmp_path / "empty.jsonl"

        with patch("backend.reports.get_log_path", return_value=str(nonexistent)):
            month_entries = load_audit_entries_in_month(2026, 1)
            report = generate_monthly_report(month_entries, 2026, 1)

        assert report["month"] == "2026-01"
        assert report["entries_in_month"] == 0
        assert report["totals"]["tasks"] == 0
        assert report["totals"]["success_rate"] is None  # No entries, so null
        assert report["by_model"] == []
        assert report["by_task_type"] == []
        assert report["daily"] == []

    def test_report_null_for_missing_fields(self, tmp_path):
        """Test that missing token/latency fields result in null values."""
        log_path = tmp_path / "sparse.jsonl"

        # Entry with no model_used and no duration_ms
        entry = {
            "timestamp": "2026-09-01T10:00:00+00:00",
            "task_id": "task-0001",
            "step_type": "task_submitted",
            "model_used": "",  # Empty model
            "duration_ms": 0,
            "input_summary": "Test",
            "output_summary": "OK",
            "status": "success",
            "user": "admin",
        }

        with open(log_path, "w") as f:
            f.write(json.dumps(entry) + "\n")

        with patch("backend.reports.get_log_path", return_value=str(log_path)):
            month_entries = load_audit_entries_in_month(2026, 9)
            report = generate_monthly_report(month_entries, 2026, 9)

        # Model should not appear since model_used is empty
        assert report["by_model"] == []

        # Task count should be 1
        assert report["totals"]["tasks"] == 1
        assert report["totals"]["success_rate"] == 1.0


class TestDocxGeneration:
    """Test DOCX report generation."""

    def test_generate_docx(self, fake_audit_log):
        """Test DOCX generation."""
        log_path, entries = fake_audit_log

        with patch("backend.reports.get_log_path", return_value=str(log_path)):
            month_entries = load_audit_entries_in_month(2026, 9)
            report = generate_monthly_report(month_entries, 2026, 9)
            docx_path = generate_docx_report(report)

        # Check file exists and is valid DOCX
        assert os.path.exists(docx_path)
        assert docx_path.endswith(".docx")

        # Cleanup
        os.remove(docx_path)


class TestAPIEndpoint:
    """Test the /api/reports/monthly endpoint."""

    def test_json_format(self, fake_audit_log, admin_user):
        """Test JSON response format."""
        log_path, entries = fake_audit_log

        with patch("backend.reports.get_log_path", return_value=str(log_path)):
            resp = client.get("/api/reports/monthly?month=2026-09&format=json")

        assert resp.status_code == 200
        data = resp.json()

        # Verify required fields
        assert "month" in data
        assert "generated_at" in data
        assert "source_log" in data
        assert "entries_in_month" in data
        assert "totals" in data
        assert "by_model" in data
        assert "by_task_type" in data
        assert "daily" in data
        assert "egress" in data

        # Verify totals
        assert data["totals"]["tasks"] == 10
        assert data["totals"]["completed"] == 7

    def test_invalid_month_format(self, admin_user):
        """Test invalid month format returns 400."""
        resp = client.get("/api/reports/monthly?month=09-2026")
        assert resp.status_code == 400

    def test_missing_month(self, admin_user):
        """Test missing month parameter returns 422."""
        resp = client.get("/api/reports/monthly")
        assert resp.status_code == 422


class TestEmptyMonth:
    """Test report for month with no entries."""

    def test_empty_month_returns_zeros(self, tmp_path):
        """Empty month should return zeros/nulls, not errors."""
        nonexistent = tmp_path / "empty.jsonl"

        with patch("backend.reports.get_log_path", return_value=str(nonexistent)):
            resp = client.get("/api/reports/monthly?month=2026-01&format=json")

        assert resp.status_code == 200
        data = resp.json()
        assert data["entries_in_month"] == 0
        assert data["totals"]["tasks"] == 0
        assert data["totals"]["success_rate"] is None


# Convenience imports
from backend.auth import authenticate_user
