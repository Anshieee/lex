# backend/tools/audit_config.py
"""
Shared configuration for audit logging.
"""
import os

LOG_PATH = "data/audit_log.jsonl"
AUDIT_KEY_ENV = "LEX_AUDIT_HMAC_KEY"
JWT_SECRET_ENV = "LEX_JWT_SECRET"
JWT_SECRET_FILE = "data/.jwt_secret"
