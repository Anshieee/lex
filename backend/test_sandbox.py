# backend/test_sandbox.py
from backend.tools.sandbox_runner import tool_execute_pressure_calculation

def test_sandbox():
    print("Running sandboxed calculation test...")
    res = tool_execute_pressure_calculation(measured_p=17.8, sop_max_p=15.2, tag="P-104A")
    print(f"Execution Mode: {res['mode']}")
    print(f"Status: {res['status']}")
    print("Stdout:\n" + res["stdout"])
    assert res["status"] == "success"
    print("\n[SANDBOX TEST PASSED]")

if __name__ == "__main__":
    test_sandbox()
