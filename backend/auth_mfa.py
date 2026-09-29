# backend/auth_mfa.py
"""
TOTP-based Multi-Factor Authentication for LEX Workbench.
Implements RFC 6238 TOTP (SHA-1, 6 digits, 30s step) with enrollment, verification, and backup codes.
"""
import os
import sqlite3
import time
import secrets
import base64
import hashlib
import hmac
import json
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Tuple
from io import BytesIO

import pyotp
import qrcode
import jwt
import bcrypt
from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from backend.auth import (
    JWT_SECRET, JWT_ALGORITHM, DB_PATH, _get_db,
    get_current_user, require_admin, create_token
)

# ── Config ───────────────────────────────────────────────────────────────

# TOTP settings (RFC 6238)
TOTP_DIGITS = 6
TOTP_STEP = 30
TOTP_WINDOW = int(os.environ.get("LEX_TOTP_WINDOW", "1"))  # +/- steps accepted
REQUIRE_TOTP = os.environ.get("LEX_REQUIRE_TOTP", "1") == "1"

# Token scopes
MFA_TOKEN_EXPIRY_MIN = 5
ENROLL_TOKEN_EXPIRY_MIN = 10

# Lockout settings
MAX_FAILURES = 5
LOCKOUT_MINUTES = 5

# JWT secret handling — must come from env, fallback to persisted file
JWT_SECRET_FILE = "data/.jwt_secret"


def get_jwt_secret() -> str:
    """Get JWT secret from env or persisted file; never use hardcoded default."""
    secret = os.environ.get("LEX_JWT_SECRET")
    if secret:
        return secret
    # Try to read from persisted file
    os.makedirs(os.path.dirname(JWT_SECRET_FILE), exist_ok=True)
    if os.path.exists(JWT_SECRET_FILE):
        with open(JWT_SECRET_FILE, "r") as f:
            return f.read().strip()
    # Generate new secret and persist (mode 0600)
    new_secret = secrets.token_urlsafe(48)
    with open(JWT_SECRET_FILE, "w") as f:
        f.write(new_secret)
    os.chmod(JWT_SECRET_FILE, 0o600)
    return new_secret


def init_mfa_db():
    """Create MFA tables and failure tracking."""
    conn = _get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_mfa (
            user_id INTEGER PRIMARY KEY,
            totp_secret TEXT NOT NULL,
            backup_codes_hash TEXT NOT NULL,  -- JSON array of bcrypt hashes
            enrolled_at TEXT NOT NULL,
            last_used_step INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS auth_failures (
            username TEXT PRIMARY KEY,
            failures INTEGER NOT NULL DEFAULT 0,
            locked_until INTEGER
        )
    """)
    conn.commit()
    conn.close()


def check_lockout(username: str) -> Optional[int]:
    """Check if user is locked out. Returns retry_after_seconds or None."""
    conn = _get_db()
    row = conn.execute(
        "SELECT failures, locked_until FROM auth_failures WHERE username = ?",
        (username,)
    ).fetchone()
    conn.close()
    if row is None:
        return None
    if row["locked_until"] and row["locked_until"] > int(time.time()):
        return row["locked_until"] - int(time.time())
    if row["failures"] >= MAX_FAILURES:
        return LOCKOUT_MINUTES * 60
    return None


def record_failure(username: str):
    """Record a failed attempt; lock after MAX_FAILURES."""
    conn = _get_db()
    now = int(time.time())
    row = conn.execute(
        "SELECT failures, locked_until FROM auth_failures WHERE username = ?",
        (username,)
    ).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO auth_failures (username, failures, locked_until) VALUES (?, 1, 0)",
            (username,)
        )
    else:
        new_failures = row["failures"] + 1
        locked_until = 0
        if new_failures >= MAX_FAILURES:
            locked_until = now + LOCKOUT_MINUTES * 60
        conn.execute(
            "UPDATE auth_failures SET failures = ?, locked_until = ? WHERE username = ?",
            (new_failures, locked_until, username)
        )
    conn.commit()
    conn.close()


def clear_failures(username: str):
    """Clear failure count on successful auth."""
    conn = _get_db()
    conn.execute("DELETE FROM auth_failures WHERE username = ?", (username,))
    conn.commit()
    conn.close()


def generate_totp_secret() -> str:
    """Generate a new TOTP secret (base32)."""
    return pyotp.random_base32()


def get_totp_uri(username: str, secret: str) -> str:
    """Generate otpauth:// URI for QR code."""
    return pyotp.totp.TOTP(secret, digits=TOTP_DIGITS, interval=TOTP_STEP).provisioning_uri(
        name=username, issuer_name="LEX Workbench"
    )


def generate_qr_png_base64(uri: str) -> str:
    """Generate QR code PNG as base64."""
    qr = qrcode.make(uri, box_size=10, border=4)
    buf = BytesIO()
    qr.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def generate_backup_codes(count: int = 10) -> List[str]:
    """Generate random backup codes (8 chars each)."""
    return [secrets.token_urlsafe(6)[:8] for _ in range(count)]


def hash_backup_codes(codes: List[str]) -> str:
    """Hash backup codes with bcrypt; return JSON array of hashes."""
    hashes = [bcrypt.hashpw(c.encode(), bcrypt.gensalt()).decode() for c in codes]
    return json.dumps(hashes)


def verify_backup_code(provided: str, hashes_json: str) -> Tuple[bool, str]:
    """Verify a backup code against stored hashes. Returns (success, updated_hashes_json)."""
    try:
        hashes = json.loads(hashes_json)
    except json.JSONDecodeError:
        return False, hashes_json
    for i, h in enumerate(hashes):
        if bcrypt.checkpw(provided.encode(), h.encode()):
            # Remove this hash (single-use)
            hashes.pop(i)
            return True, json.dumps(hashes)
    return False, hashes_json


def verify_totp_code(secret: str, code: str, last_used_step: Optional[int] = None) -> bool:
    """Verify TOTP code with replay protection.
    Uses pyotp's built-in verify with explicit UTC time for correct step handling.
    """
    import datetime
    totp = pyotp.TOTP(secret, digits=TOTP_DIGITS, interval=TOTP_STEP)
    current_step = int(time.time()) // TOTP_STEP

    # Use pyotp's verify with explicit UTC time to match our step calculation
    # datetime.datetime.utcnow() gives UTC time; timecode() uses calendar.timegm() for UTC
    if not totp.verify(code, for_time=datetime.datetime.utcnow(), valid_window=TOTP_WINDOW):
        return False

    # Replay protection: check if the step used is <= last_used_step
    # We need to determine which step was actually matched
    for offset in range(-TOTP_WINDOW, TOTP_WINDOW + 1):
        step = current_step + offset
        if last_used_step is not None and step <= last_used_step:
            continue
        # Check this step using correct timestamp conversion
        if code == totp.at(step * TOTP_STEP):
            return True
    return False


def update_last_used_step(user_id: int, step: int):
    """Update the last used TOTP step for replay protection."""
    conn = _get_db()
    conn.execute(
        "UPDATE user_mfa SET last_used_step = ? WHERE user_id = ?",
        (step, user_id)
    )
    conn.commit()
    conn.close()


def is_mfa_enrolled(user_id: int) -> bool:
    """Check if user has MFA enrolled."""
    conn = _get_db()
    row = conn.execute("SELECT 1 FROM user_mfa WHERE user_id = ?", (user_id,)).fetchone()
    conn.close()
    return row is not None


def get_mfa_data(user_id: int) -> Optional[dict]:
    """Get user's MFA data (secret, backup_codes_hash, last_used_step)."""
    conn = _get_db()
    row = conn.execute(
        "SELECT totp_secret, backup_codes_hash, last_used_step FROM user_mfa WHERE user_id = ?",
        (user_id,)
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return {
        "totp_secret": row["totp_secret"],
        "backup_codes_hash": row["backup_codes_hash"],
        "last_used_step": row["last_used_step"],
    }


def create_mfa_token(user: dict) -> str:
    """Create short-lived MFA token (scope: mfa)."""
    payload = {
        "sub": user["username"],
        "role": user["role"],
        "user_id": user["id"],
        "scope": "mfa",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=MFA_TOKEN_EXPIRY_MIN),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_enroll_token(user: dict) -> str:
    """Create short-lived enrollment token (scope: enroll)."""
    payload = {
        "sub": user["username"],
        "role": user["role"],
        "user_id": user["id"],
        "scope": "enroll",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ENROLL_TOKEN_EXPIRY_MIN),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_mfa_token(token: str) -> tuple[Optional[dict], Optional[str]]:
    """Decode and validate MFA token (scope: mfa).
    Returns (payload, error_reason) where error_reason is 'expired', 'invalid', or None.
    """
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("scope") != "mfa":
            return None, "invalid"
        return payload, None
    except jwt.ExpiredSignatureError:
        return None, "expired"
    except jwt.InvalidTokenError:
        return None, "invalid"


def decode_enroll_token(token: str) -> Optional[dict]:
    """Decode and validate enrollment token (scope: enroll)."""
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("scope") != "enroll":
            return None
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


# ── Pydantic Models ──────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    status: str  # "ok" | "mfa_required" | "enrollment_required"
    access_token: Optional[str] = None
    token_type: Optional[str] = None
    role: Optional[str] = None
    mfa_token: Optional[str] = None
    enroll_token: Optional[str] = None


class EnrollResponse(BaseModel):
    otpauth_uri: str
    qr_png_base64: str
    backup_codes: List[str]


class ConfirmEnrollRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class ConfirmEnrollResponse(BaseModel):
    status: str = "ok"
    access_token: str
    token_type: str = "bearer"
    role: str


class MFAVerifyRequest(BaseModel):
    mfa_token: str
    code: Optional[str] = Field(None, min_length=6, max_length=6, pattern=r"^\d{6}$")
    backup_code: Optional[str] = Field(None, min_length=8, max_length=8)


class MFAVerifyResponse(BaseModel):
    status: str = "ok"
    access_token: str
    token_type: str = "bearer"
    role: str


# ── Router ───────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/auth", tags=["auth-mfa"])


@router.post("/login", response_model=LoginResponse)
async def login_with_mfa(req: LoginRequest):
    """
    Authenticate user. Returns:
    - status=ok + access_token (if TOTP not required or not enrolled and not required)
    - status=mfa_required + mfa_token (if enrolled and TOTP required)
    - status=enrollment_required + enroll_token (if not enrolled and TOTP required)
    """
    # Check lockout first
    retry_after = check_lockout(req.username)
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail={"detail": "locked", "retry_after_s": retry_after},
        )

    # Verify credentials
    conn = _get_db()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (req.username,)).fetchone()
    conn.close()

    if row is None or not bcrypt.checkpw(req.password.encode(), row["password_hash"].encode()):
        record_failure(req.username)
        raise HTTPException(status_code=401, detail="invalid_credentials")

    user = {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "display_name": row["display_name"],
    }

    # Clear failures on successful password
    clear_failures(req.username)

    # Check MFA enrollment
    enrolled = is_mfa_enrolled(user["id"])

    if not REQUIRE_TOTP:
        # TOTP not required globally
        token = create_token(user)
        return LoginResponse(status="ok", access_token=token, token_type="bearer", role=user["role"])

    if not enrolled:
        # Enrollment required
        enroll_token = create_enroll_token(user)
        return LoginResponse(
            status="enrollment_required",
            enroll_token=enroll_token,
        )

    # Enrolled and TOTP required
    mfa_token = create_mfa_token(user)
    return LoginResponse(
        status="mfa_required",
        mfa_token=mfa_token,
    )


@router.post("/totp/enroll", response_model=EnrollResponse)
async def enroll_totp(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=True)),
):
    """
    Start TOTP enrollment. Requires Bearer <enroll_token>.
    Returns otpauth_uri, qr_png_base64, and backup_codes (shown once).
    """
    payload = decode_enroll_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired enrollment token")

    user_id = payload["user_id"]

    # Generate secret and backup codes
    secret = generate_totp_secret()
    backup_codes = generate_backup_codes(10)
    backup_hashes = hash_backup_codes(backup_codes)
    otpauth_uri = get_totp_uri(payload["sub"], secret)
    qr_png_base64 = generate_qr_png_base64(otpauth_uri)

    # Store secret and backup codes (but not confirmed yet)
    conn = _get_db()
    conn.execute(
        """INSERT OR REPLACE INTO user_mfa (user_id, totp_secret, backup_codes_hash, enrolled_at, last_used_step)
           VALUES (?, ?, ?, ?, ?)""",
        (user_id, secret, backup_hashes, datetime.now(timezone.utc).isoformat(), None),
    )
    conn.commit()
    conn.close()

    return EnrollResponse(
        otpauth_uri=otpauth_uri,
        qr_png_base64=qr_png_base64,
        backup_codes=backup_codes,
    )


@router.post("/totp/confirm", response_model=ConfirmEnrollResponse)
async def confirm_enroll(
    req: ConfirmEnrollRequest,
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=True)),
):
    """
    Confirm TOTP enrollment with a code. Requires Bearer <enroll_token>.
    Returns full access token on success.
    """
    payload = decode_enroll_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired enrollment token")

    user_id = payload["user_id"]
    mfa_data = get_mfa_data(user_id)
    if mfa_data is None:
        raise HTTPException(status_code=401, detail="Enrollment not started")

    # Verify the code
    if not verify_totp_code(mfa_data["totp_secret"], req.code):
        raise HTTPException(status_code=401, detail="invalid_code")

    # Update last_used_step
    current_step = int(time.time()) // TOTP_STEP
    update_last_used_step(user_id, current_step)

    # Issue full access token
    user = {
        "id": user_id,
        "username": payload["sub"],
        "role": payload["role"],
        "display_name": payload.get("display_name", payload["sub"]),
    }
    access_token = create_token(user)
    return ConfirmEnrollResponse(access_token=access_token, role=user["role"])


@router.post("/mfa/verify", response_model=MFAVerifyResponse)
async def verify_mfa(req: MFAVerifyRequest):
    """
    Verify TOTP code or backup code using mfa_token.
    Returns full access token on success.
    """
    payload, error_reason = decode_mfa_token(req.mfa_token)
    if payload is None:
        detail = {"detail": "expired_mfa_token"} if error_reason == "expired" else {"detail": "invalid_code"}
        raise HTTPException(status_code=401, detail=detail)

    # Check lockout
    retry_after = check_lockout(payload["sub"])
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail={"detail": "locked", "retry_after_s": retry_after},
        )

    user_id = payload["user_id"]
    mfa_data = get_mfa_data(user_id)
    if mfa_data is None:
        raise HTTPException(status_code=401, detail="MFA not enrolled")

    verified = False
    if req.code:
        # TOTP code verification
        if verify_totp_code(mfa_data["totp_secret"], req.code, mfa_data["last_used_step"]):
            current_step = int(time.time()) // TOTP_STEP
            update_last_used_step(user_id, current_step)
            verified = True
    elif req.backup_code:
        # Backup code verification (single-use)
        success, new_hashes = verify_backup_code(req.backup_code, mfa_data["backup_codes_hash"])
        if success:
            # Update backup codes hash
            conn = _get_db()
            conn.execute(
                "UPDATE user_mfa SET backup_codes_hash = ? WHERE user_id = ?",
                (new_hashes, user_id),
            )
            conn.commit()
            conn.close()
            verified = True

    if not verified:
        record_failure(payload["sub"])
        raise HTTPException(status_code=401, detail="invalid_code")

    clear_failures(payload["sub"])

    user = {
        "id": user_id,
        "username": payload["sub"],
        "role": payload["role"],
        "display_name": payload.get("display_name", payload["sub"]),
    }
    access_token = create_token(user)
    return MFAVerifyResponse(access_token=access_token, role=user["role"])
from datetime import datetime, timedelta, timezone
import os
import sqlite3
import time
import secrets
import base64
import hashlib
import hmac