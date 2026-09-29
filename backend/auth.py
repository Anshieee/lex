# backend/auth.py
"""
Local JWT authentication for the Sovereign AI Workbench.
All user data stays on-premise in SQLite — zero external auth services.
"""
import os
import sqlite3
import time
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

# ── Config ───────────────────────────────────────────────────────────
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24
DB_PATH = "data/users.db"
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


# For backward compatibility — use the function
JWT_SECRET = get_jwt_secret()

security = HTTPBearer(auto_error=False)

# ── Models ───────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class UserInfo(BaseModel):
    id: int
    username: str
    role: str
    display_name: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo

# ── Database ─────────────────────────────────────────────────────────

def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_user_db():
    """Create users table and seed preset accounts on first boot."""
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    conn = _get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'operator',
            display_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.commit()

    # Seed default users if table is empty
    count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count == 0:
        _seed_users(conn)
    conn.close()


def _seed_users(conn: sqlite3.Connection):
    """Preset demo users for hackathon."""
    users = [
        ("admin", "admin123", "admin", "System Administrator"),
        ("operator", "operator123", "operator", "Field Operator"),
        ("engineer", "engineer123", "operator", "Process Engineer"),
    ]
    for username, password, role, display_name in users:
        hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        conn.execute(
            "INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)",
            (username, hashed, role, display_name)
        )
    conn.commit()


# ── Auth Logic ───────────────────────────────────────────────────────

def authenticate_user(username: str, password: str) -> Optional[dict]:
    """Verify credentials against local SQLite store."""
    conn = _get_db()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()

    if row is None:
        return None

    if not bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
        return None

    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "display_name": row["display_name"],
    }


def create_token(user: dict) -> str:
    """Generate a signed JWT token."""
    payload = {
        "sub": user["username"],
        "role": user["role"],
        "display_name": user["display_name"],
        "user_id": user["id"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


# ── FastAPI Dependencies ─────────────────────────────────────────────

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """Extract and validate the current user from the Authorization header.
    Rejects tokens with scope 'enroll' or 'mfa' — only full access tokens allowed.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated — please log in",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired or invalid",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Reject scoped tokens (enroll/mfa) on standard endpoints
    token_scope = payload.get("scope")
    if token_scope in ("enroll", "mfa"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid token scope for this endpoint",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "id": payload.get("user_id"),
        "username": payload["sub"],
        "role": payload["role"],
        "display_name": payload.get("display_name", payload["sub"]),
    }


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Dependency that requires admin role."""
    if user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
