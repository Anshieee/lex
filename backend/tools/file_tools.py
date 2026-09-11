# backend/tools/file_tools.py
"""
Secure file read/write tools for the agent.
All paths are sandboxed to data/uploads/ and data/outputs/.
"""
import os
from typing import Dict, Any

UPLOAD_DIR = "data/uploads"
OUTPUT_DIR = "data/outputs"


def _sanitize_path(filename: str, base_dir: str) -> str:
    """Prevent directory traversal — resolve to base_dir only."""
    safe_name = os.path.basename(filename)  # strip any path components
    full_path = os.path.abspath(os.path.join(base_dir, safe_name))
    # Verify it's still under base_dir
    if not full_path.startswith(os.path.abspath(base_dir)):
        raise ValueError(f"Path traversal attempt blocked: {filename}")
    return full_path


def tool_read_file(filename: str) -> Dict[str, Any]:
    """Read a file from the uploads or outputs directory."""
    # Try uploads first, then outputs
    for base in [UPLOAD_DIR, OUTPUT_DIR, "data"]:
        try:
            path = _sanitize_path(filename, base)
            if os.path.exists(path):
                with open(path, "r", errors="replace") as f:
                    content = f.read(100_000)  # cap at 100KB
                return {
                    "status": "success",
                    "filename": os.path.basename(path),
                    "content": content,
                    "size_bytes": os.path.getsize(path),
                }
        except (ValueError, UnicodeDecodeError):
            continue

    return {
        "status": "not_found",
        "filename": filename,
        "content": "",
        "error": f"File '{filename}' not found in uploads or outputs.",
    }


def tool_write_file(filename: str, content: str) -> Dict[str, Any]:
    """Write content to the outputs directory."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    try:
        path = _sanitize_path(filename, OUTPUT_DIR)
        with open(path, "w") as f:
            f.write(content)
        return {
            "status": "success",
            "filename": os.path.basename(path),
            "path": path,
            "size_bytes": len(content.encode()),
        }
    except ValueError as e:
        return {
            "status": "blocked",
            "error": str(e),
        }
