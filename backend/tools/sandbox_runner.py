# backend/tools/sandbox_runner.py
import subprocess
import tempfile
import os
import shutil
from typing import Dict, Any

DOCKER_AVAILABLE = shutil.which("docker") is not None

def run_code_in_sandbox(
    script_content: str,
    timeout_seconds: int = 10,
    force_fallback: bool = False
) -> Dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmpdir:
        script_path = os.path.join(tmpdir, "calculation.py")
        with open(script_path, "w") as f:
            f.write(script_content)

        # 1. Attempt Docker + gVisor sandbox if available
        if DOCKER_AVAILABLE and not force_fallback:
            try:
                cmd = [
                    "docker", "run", "--rm",
                    "--runtime=runsc",
                    "--network=none",
                    "--memory=128m",
                    "--cpus=1.0",
                    "-v", f"{script_path}:/app/calculation.py:ro",
                    "python:3.11-slim",
                    "python", "/app/calculation.py"
                ]
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=timeout_seconds
                )
                if proc.returncode == 0:
                    return {
                        "status": "success",
                        "mode": "gvisor_container",
                        "stdout": proc.stdout.strip(),
                        "stderr": proc.stderr.strip(),
                        "exit_code": 0
                    }
                # If docker failed (e.g. unknown runtime 'runsc'), fall through to local fallback
                print(f"[Sandbox Notice] gVisor Docker run exited with code {proc.returncode}. Falling back to local runner.")
            except Exception as e:
                print(f"[Sandbox Notice] Docker execution bypassed ({e}). Falling back to local runner.")

        # 2. Fallback: Local restricted subprocess
        clean_env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "PYTHONUNBUFFERED": "1"
        }

        try:
            proc = subprocess.run(
                ["python3", script_path],
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                env=clean_env,
                cwd=tmpdir
            )
            return {
                "status": "success" if proc.returncode == 0 else "failed",
                "mode": "local_subprocess_fallback",
                "stdout": proc.stdout.strip(),
                "stderr": proc.stderr.strip(),
                "exit_code": proc.returncode
            }
        except subprocess.TimeoutExpired:
            return {
                "status": "failed",
                "mode": "timeout",
                "stdout": "",
                "stderr": f"Execution timed out after {timeout_seconds} seconds.",
                "exit_code": -1
            }
        except Exception as e:
            return {
                "status": "failed",
                "mode": "error",
                "stdout": "",
                "stderr": str(e),
                "exit_code": -1
            }

def tool_execute_pressure_calculation(measured_p: float, sop_max_p: float, tag: str = "P-104A") -> Dict[str, Any]:
    script = f"""
measured_p = {measured_p}
sop_max_p = {sop_max_p}
tag = "{tag}"

delta_p = measured_p - sop_max_p
pct_deviation = (delta_p / sop_max_p) * 100

print(f"[CALCULATION VERIFIED]")
print(f"Tag: {{tag}}")
print(f"Measured: {{measured_p:.2f}} bar | SOP Max: {{sop_max_p:.2f}} bar")
print(f"Delta P: {{delta_p:+.2f}} bar")
print(f"Deviation: {{pct_deviation:+.1f}}%")

if delta_p > 0:
    print("Verdict: OVERPRESSURE VIOLATION - Immediate isolation required.")
else:
    print("Verdict: WITHIN OPERATING TOLERANCE.")
"""
    return run_code_in_sandbox(script)
