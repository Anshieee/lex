#!/usr/bin/env python3
"""
gVisor Sandbox Attack Validation Script

This script runs inside a gVisor sandboxed container to validate isolation.
Two tests:
1. Network Egress Test — attempts connection to external IP (should fail)
2. Filesystem Traversal Test — attempts read of /etc/shadow (should fail)

Usage: python attack_test.py
Exit code 0 = both tests PASS (isolation verified)
Exit code 1 = any test FAIL (isolation broken)
"""

import socket
import sys
import os

def test_network_egress() -> bool:
    """
    Test 1: Network Egress
    Attempt to connect to 8.8.8.8:53 (Google DNS).
    In a properly isolated sandbox, this should fail (connection refused/blocked).
    Returns True if test PASSES (connection blocked), False if FAILS (connection succeeded).
    """
    print("[TEST] Network Egress — attempting socket.create_connection(('8.8.8.8', 53), timeout=2)")
    try:
        sock = socket.create_connection(("8.8.8.8", 53), timeout=2)
        sock.close()
        print("[FAIL] Network egress SUCCEEDED — external connection established!")
        print("       This indicates the sandbox is NOT properly isolated from the internet.")
        return False
    except (socket.timeout, ConnectionRefusedError, OSError) as e:
        print(f"[PASS] Network egress BLOCKED as expected: {type(e).__name__}: {e}")
        return True
    except Exception as e:
        print(f"[PASS] Network egress BLOCKED (unexpected exception): {type(e).__name__}: {e}")
        return True


def test_filesystem_traversal() -> bool:
    """
    Test 2: Filesystem Traversal
    Attempt to read /etc/shadow (sensitive system file).
    In a properly isolated sandbox, this should fail (permission denied or file not accessible).
    Returns True if test PASSES (read blocked), False if FAILS (read succeeded).
    """
    print("[TEST] Filesystem Traversal — attempting open('/etc/shadow', 'r')")
    try:
        with open("/etc/shadow", "r") as f:
            content = f.read()
            if content:
                print("[FAIL] Filesystem traversal SUCCEEDED — read /etc/shadow!")
                print("       This indicates the sandbox has host filesystem access.")
                return False
            else:
                print("[FAIL] Filesystem traversal SUCCEEDED — opened /etc/shadow (empty)")
                return False
    except (PermissionError, FileNotFoundError, IsADirectoryError, OSError) as e:
        print(f"[PASS] Filesystem traversal BLOCKED as expected: {type(e).__name__}: {e}")
        return True
    except Exception as e:
        print(f"[PASS] Filesystem traversal BLOCKED (unexpected exception): {type(e).__name__}: {e}")
        return True


def main():
    print("=" * 60)
    print("gVisor Sandbox Attack Validation")
    print("=" * 60)
    print(f"Running as: uid={os.getuid()}, gid={os.getgid()}")
    print(f"Python: {sys.version}")
    print()

    results = []
    results.append(("Network Egress", test_network_egress()))
    print()
    results.append(("Filesystem Traversal", test_filesystem_traversal()))
    print()

    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    all_passed = True
    for name, passed in results:
        status = "PASS" if passed else "FAIL"
        print(f"  {name}: {status}")
        if not passed:
            all_passed = False

    if all_passed:
        print("\n[RESULT] ALL TESTS PASSED — Sandbox isolation VERIFIED")
        return 0
    else:
        print("\n[RESULT] SOME TESTS FAILED — Sandbox isolation COMPROMISED")
        return 1


if __name__ == "__main__":
    sys.exit(main())