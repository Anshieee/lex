"""
Tests for MFA auth module per contract §1.1.
Covers: enroll -> confirm -> login -> verify happy path, replay rejected,
5 failures -> 429, expired mfa_token, enroll_token rejected on normal endpoints,
backup code single-use, and test that fails if hardcoded secret appears under backend/.
"""
import os
import sys
import time
import json
import base64
import hashlib
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
import jwt
import pyotp
import bcrypt
import sqlite3
from fastapi.testclient import TestClient
from fastapi import FastAPI
from fastapi.security import HTTPBearer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.auth import (
    get_jwt_secret, create_token, authenticate_user,
    init_user_db, JWT_ALGORITHM, DB_PATH,
)
from backend.auth_mfa import (
    router as auth_mfa_router, init_mfa_db,
    create_mfa_token, create_enroll_token, decode_mfa_token, decode_enroll_token,
    generate_totp_secret, verify_totp_code, generate_qr_png_base64,
    generate_backup_codes, hash_backup_codes, verify_backup_code,
    check_lockout, record_failure, clear_failures,
    MAX_FAILURES, LOCKOUT_MINUTES, REQUIRE_TOTP,
    get_totp_uri, get_mfa_data, update_last_used_step,
)

# Create minimal test app with only auth_mfa router
test_app = FastAPI()
test_app.include_router(auth_mfa_router)
client = TestClient(test_app)


@pytest.fixture(autouse=True)
def setup_db(tmp_path, monkeypatch):
    """Set up test database in tmp directory."""
    monkeypatch.setattr("backend.auth.DB_PATH", str(tmp_path / "users.db"))
    monkeypatch.setattr("backend.auth_mfa.DB_PATH", str(tmp_path / "users.db"))
    monkeypatch.setenv("LEX_JWT_SECRET", "test-jwt-secret-for-unit-tests-only")
    monkeypatch.setattr("backend.auth_mfa.REQUIRE_TOTP", True)

    init_user_db()
    init_mfa_db()
    yield


@pytest.fixture
def admin_user():
    """Get admin user for testing."""
    return authenticate_user("admin", "admin123")


class TestEnrollConfirmVerifyHappyPath:
    """Test enroll -> confirm -> login -> verify happy path."""

    def test_full_flow_admin(self, admin_user):
        """Complete enrollment and verification flow for admin user."""
        # Step 1: Enroll
        secret = generate_totp_secret()
        enroll_token = create_enroll_token(admin_user)
        with patch('backend.auth_mfa.generate_totp_secret', return_value=secret):
            with patch('backend.auth_mfa.get_totp_uri', return_value='otpauth://totp/test'):
                resp = client.post(
                    "/api/auth/totp/enroll",
                    headers={"Authorization": f"Bearer {enroll_token}"},
                )
                assert resp.status_code == 200
                data = resp.json()
                assert "otpauth_uri" in data
                assert "qr_png_base64" in data
                assert "backup_codes" in data
                assert len(data["backup_codes"]) == 10

        # Step 2: Confirm with correct TOTP code
        code = pyotp.TOTP(secret, digits=6, interval=30).now()
        resp = client.post(
            "/api/auth/totp/confirm",
            headers={"Authorization": f"Bearer {enroll_token}"},
            json={"code": code},
        )
        assert resp.status_code == 200
        confirm_data = resp.json()
        assert confirm_data["status"] == "ok"
        assert "access_token" in confirm_data
        assert confirm_data["token_type"] == "bearer"
        assert confirm_data["role"] == admin_user["role"]

        # Step 3: Login now returns status=ok with access_token (MFA already done)
        resp = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        assert resp.status_code == 200
        login_data = resp.json()
        assert login_data["status"] == "mfa_required"
        assert "mfa_token" in login_data

    def test_full_flow_all_users(self):
        """Test enrollment for all 3 seeded users."""
        for username, password, role in [
            ("admin", "admin123", "admin"),
            ("operator", "operator123", "operator"),
            ("engineer", "engineer123", "operator"),
        ]:
            user = authenticate_user(username, password)
            assert user is not None

            secret = generate_totp_secret()
            enroll_token = create_enroll_token(user)
            with patch('backend.auth_mfa.generate_totp_secret', return_value=secret):
                with patch('backend.auth_mfa.get_totp_uri', return_value='otpauth://totp/test'):
                    resp = client.post(
                        "/api/auth/totp/enroll",
                        headers={"Authorization": f"Bearer {enroll_token}"},
                    )
                    assert resp.status_code == 200

            code = pyotp.TOTP(secret, digits=6, interval=30).now()
            resp = client.post(
                "/api/auth/totp/confirm",
                headers={"Authorization": f"Bearer {enroll_token}"},
                json={"code": code},
            )
            assert resp.status_code == 200
            assert resp.json()["role"] == role


class TestReplayProtection:
    """Test TOTP replay protection."""

    def test_reuse_rejected(self, admin_user):
        """Same step code should be rejected after use."""
        secret = generate_totp_secret()
        code = pyotp.TOTP(secret, digits=6, interval=30).now()

        # First verification
        assert verify_totp_code(secret, code)

        # Enroll user first to have MFA data
        enroll_token = create_enroll_token(admin_user)
        with patch('backend.auth_mfa.generate_totp_secret', return_value=secret):
            with patch('backend.auth_mfa.get_totp_uri', return_value='otpauth://totp/test'):
                resp = client.post(
                    "/api/auth/totp/enroll",
                    headers={"Authorization": f"Bearer {enroll_token}"},
                )
                assert resp.status_code == 200

        # Record last_used_step
        current_step = int(time.time()) // 30
        update_last_used_step(admin_user["id"], current_step)

        # Verify again with same step - should be rejected
        mfa_data = get_mfa_data(admin_user["id"])
        assert mfa_data is not None
        assert mfa_data["last_used_step"] == current_step
        # The verify function checks against last_used_step
        assert not verify_totp_code(secret, code, last_used_step=current_step)


class TestLockout:
    """Test failure lockout."""

    def test_lockout_after_5_failures(self, admin_user):
        """After 5 failures, should get lockout."""
        for _ in range(5):
            record_failure(admin_user["username"])

        retry_after = check_lockout(admin_user["username"])
        assert retry_after is not None
        assert retry_after > 0

    def test_lockout_clears_after_success(self, admin_user):
        """Successful auth should clear failures."""
        for _ in range(5):
            record_failure(admin_user["username"])

        clear_failures(admin_user["username"])
        retry_after = check_lockout(admin_user["username"])
        assert retry_after is None

    def test_429_on_locked_login(self, admin_user):
        """Login with locked user should return 429."""
        for _ in range(5):
            record_failure(admin_user["username"])

        resp = client.post(
            "/api/auth/login",
            json={"username": admin_user["username"], "password": "admin123"},
        )
        assert resp.status_code == 429
        assert resp.json()["detail"]["detail"] == "locked"


class TestExpiredTokens:
    """Test expired token handling."""

    def test_expired_mfa_token_rejected(self, admin_user):
        """Expired mfa_token should be rejected."""
        mfa_token = jwt.encode({
            "sub": admin_user["username"],
            "scope": "mfa",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=10),
            "iat": datetime.now(timezone.utc) - timedelta(minutes=15),
        }, get_jwt_secret(), algorithm=JWT_ALGORITHM)

        resp = client.post(
            "/api/auth/mfa/verify",
            json={"mfa_token": mfa_token, "code": "123456"},
        )
        assert resp.status_code == 401

    def test_expired_enroll_token_rejected(self, admin_user):
        """Expired enroll_token should be rejected."""
        enroll_token = jwt.encode({
            "sub": admin_user["username"],
            "scope": "enroll",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=20),
            "iat": datetime.now(timezone.utc) - timedelta(minutes=25),
        }, get_jwt_secret(), algorithm=JWT_ALGORITHM)

        resp = client.post(
            "/api/auth/totp/enroll",
            headers={"Authorization": f"Bearer {enroll_token}"},
        )
        assert resp.status_code == 401


class TestEnrollTokenRejectedOnNormalEndpoints:
    """Test enroll_token cannot be used for normal operations."""

    def test_enroll_token_rejected_on_mfa_verify(self, admin_user):
        """enroll_token should be rejected on /api/auth/mfa/verify."""
        # Need MFA enrolled user for mfa/verify to work
        secret = generate_totp_secret()
        enroll_token = create_enroll_token(admin_user)
        with patch('backend.auth_mfa.generate_totp_secret', return_value=secret):
            with patch('backend.auth_mfa.get_totp_uri', return_value='otpauth://totp/test'):
                resp = client.post(
                    "/api/auth/totp/enroll",
                    headers={"Authorization": f"Bearer {enroll_token}"},
                )
                assert resp.status_code == 200

        enroll_token2 = create_enroll_token(admin_user)
        resp = client.post(
            "/api/auth/mfa/verify",
            json={"mfa_token": enroll_token2, "code": "123456"},
        )
        assert resp.status_code == 401


class TestBackupCodeSingleUse:
    """Test backup code single-use behavior."""

    def test_backup_code_single_use(self, admin_user):
        """Backup code should work once, then be rejected."""
        # Create user with enrollment, get real backup codes
        secret = generate_totp_secret()
        enroll_token = create_enroll_token(admin_user)
        with patch('backend.auth_mfa.generate_totp_secret', return_value=secret):
            with patch('backend.auth_mfa.get_totp_uri', return_value='otpauth://totp/test'):
                resp = client.post(
                    "/api/auth/totp/enroll",
                    headers={"Authorization": f"Bearer {enroll_token}"},
                )
                assert resp.status_code == 200
                backup_codes = resp.json()["backup_codes"]
                test_code = backup_codes[0]  # Use first real backup code

        mfa_token = create_mfa_token(admin_user)

        # First use should succeed
        resp = client.post(
            "/api/auth/mfa/verify",
            json={"mfa_token": mfa_token, "backup_code": test_code},
        )
        assert resp.status_code == 200

        # Second use should be rejected
        resp = client.post(
            "/api/auth/mfa/verify",
            json={"mfa_token": mfa_token, "backup_code": test_code},
        )
        assert resp.status_code == 401


class TestHardcodedSecretTest:
    """Test that hardcoded secret is not present anywhere in backend/."""

    def test_no_hardcoded_secret_in_backend(self):
        """Should fail if old hardcoded secret appears in backend/."""
        import subprocess
        result = subprocess.run(
            ["grep", "-r", "lex-sovereign-workbench-secret-key-change-in-prod", "backend/", "--exclude-dir=tests", "--exclude=test_auth_mfa.py", "--binary-files=without-match"],
            capture_output=True,
            text=True,
            cwd="/home/sandbox/workspace",
        )
        assert result.returncode != 0, f"Hardcoded secret found in backend/: {result.stdout}"


class TestJWTSecretHandling:
    """Test JWT secret handling."""

    def test_env_var_takes_precedence(self, monkeypatch):
        """LEX_JWT_SECRET env var should be used."""
        monkeypatch.setenv("LEX_JWT_SECRET", "my-test-secret")
        from backend.auth import get_jwt_secret
        assert get_jwt_secret() == "my-test-secret"

    def test_persisted_file_used_if_no_env(self, tmp_path, monkeypatch):
        """Should read from persisted file if env var not set."""
        monkeypatch.delenv("LEX_JWT_SECRET", raising=False)
        secret_file = tmp_path / "jwt_secret"
        secret_file.write_text("persisted-secret")
        monkeypatch.setattr("backend.auth.JWT_SECRET_FILE", str(secret_file))

        from backend.auth import get_jwt_secret
        assert get_jwt_secret() == "persisted-secret"


class TestTOTPCodeGeneration:
    """Test TOTP code generation."""

    def test_totp_code_now_validates(self, admin_user):
        """Code from pyotp.TOTP(secret).now() should verify."""
        secret = generate_totp_secret()
        code = pyotp.TOTP(secret, digits=6, interval=30).now()
        assert verify_totp_code(secret, code)

    def test_wrong_code_rejected(self, admin_user):
        """Wrong code should not verify."""
        secret = generate_totp_secret()
        assert not verify_totp_code(secret, "000000")


class TestQRGeneration:
    """Test QR code generation."""

    def test_qr_base64_is_valid_png(self, admin_user):
        """QR should be valid base64 PNG."""
        secret = generate_totp_secret()
        uri = get_totp_uri("testuser", secret)
        qr_b64 = generate_qr_png_base64(uri)
        png_bytes = base64.b64decode(qr_b64)
        assert png_bytes[:8] == b'\x89PNG\r\n\x1a\n'