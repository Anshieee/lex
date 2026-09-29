#!/usr/bin/env python3
"""Gate 0 step 2: MFA login + submit 5 mock tasks + approve them.

Writes only task ids and status lines (no secrets, codes or tokens).
"""
import json
import sqlite3
import urllib.request

import pyotp

BASE = "http://127.0.0.1:8001"
USER = "admin"


def post(path, payload, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode(), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def main():
    # 1. login -> mfa_token
    _, d = post("/api/auth/login", {"username": USER, "password": "admin123"})
    assert d.get("status") == "mfa_required", f"unexpected login state: {d.get('status')}"
    mfa_token = d["mfa_token"]

    # 2. fresh TOTP code from the stored secret
    conn = sqlite3.connect("data/users.db")
    secret = conn.execute(
        "SELECT totp_secret FROM user_mfa JOIN users ON user_mfa.user_id = users.id"
        " WHERE username = ?",
        (USER,),
    ).fetchone()[0]
    conn.close()
    code = pyotp.TOTP(secret).now()

    # 3. verify -> access token
    status, d = post("/api/auth/mfa/verify", {"mfa_token": mfa_token, "code": code})
    assert status == 200 and d.get("status") == "ok", f"mfa verify failed: {status} {d}"
    access_token = d["access_token"]
    print(f"MFA login OK, role={d.get('role')}")

    # 4. submit 5 mock-LLM tasks
    task_ids = []
    for i in range(1, 6):
        status, d = post("/api/tasks/submit", {"prompt": f"Gate 0 smoke task {i}"}, access_token)
        print(f"submit {i}: HTTP {status} -> {json.dumps(d)[:200]}")
        assert status == 200, f"task submit failed: {status} {d}"
        tid = d.get("task_id")
        assert tid, f"no task_id in response: {d}"
        task_ids.append(tid)

    # 5. approve each task
    for i, tid in enumerate(task_ids, 1):
        status, d = post(f"/api/tasks/{tid}/approve", {"approved": True}, access_token)
        print(f"approve {i} ({tid}): HTTP {status} -> {json.dumps(d)[:200]}")
        assert status == 200, f"approval failed: {status} {d}"

    print("TASK_IDS:", json.dumps(task_ids))


if __name__ == "__main__":
    main()
