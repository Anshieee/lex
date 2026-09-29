# backend/tools/verify_audit_chain.py
"""
CLI tool to verify audit chain integrity.
Usage: python -m backend.tools.verify_audit_chain [path]
Exit 0 = valid, 1 = invalid
"""
import sys
from pathlib import Path

# Add workspace root to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.tools.audit_chain import verify_chain


def main():
    log_path = sys.argv[1] if len(sys.argv) > 1 else None
    
    result = verify_chain(log_path)
    
    print(f"Valid: {result['valid']}")
    print(f"Entries checked: {result['entries_checked']}")
    print(f"First invalid seq: {result['first_invalid_seq']}")
    print(f"Chain start seq: {result['chain_start_seq']}")
    print(f"Legacy unhashed entries: {result['legacy_unhashed_entries']}")
    
    if not result["valid"]:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
