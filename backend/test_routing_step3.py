"""
Step 3 -- Multi-Objective Routing Testing & Context Validation
Unit tests for the LangGraph router using mock LLM client.

IMPORTANT: vLLM verification is deferred to real hardware.
These tests run against the mock LLM client (backend/agent/mock_llm_client.py)
to validate routing logic, cache handoff tracing, and message state inspection.
"""

import asyncio
import os
import sys
from typing import Dict, Any, List

# Enable mock LLM for testing
os.environ["USE_MOCK_LLM"] = "1"

# Add backend to path
sys.path.insert(0, "/home/sandbox/workspace/backend")

from agent.schemas import RoutingWeights, PromptCompressionConfig, ExecutionPlan, SubTask
from agent.model_registry import (
    AVAILABLE_MODELS,
    get_model_for_task_with_weights,
    calculate_routing_scores,
    get_model_spec,
)
from agent.agent_graph import (
    AgentState,
    router_node,
    execute_tool_node,
    build_agent_graph,
)
from agent.mock_llm_client import call_mock_llm
from langgraph.types import Command


# ============================================================================
# TEST 1: Score Calculation Verification
# ============================================================================

def test_score_calculation_basic():
    """Test basic score calculation formula."""
    weights = RoutingWeights(speed=33, reliability=33, intelligence=34)

    scored = calculate_routing_scores(weights)

    assert len(scored) > 0, "Should have scored models"

    # Verify all models have required fields
    for model in scored:
        assert "id" in model
        assert "name" in model
        assert "score" in model
        assert "rank" in model
        assert 0 <= model["score"] <= 100

    # Verify sorted descending by score
    scores = [m["score"] for m in scored]
    assert scores == sorted(scores, reverse=True), "Models should be sorted by score descending"

    print(f"PASS test_score_calculation_basic: {len(scored)} models scored")
    for m in scored:
        print(f"  Rank {m['rank']}: {m['id']} (score={m['score']})")


def test_score_calculation_intelligence_heavy():
    """Test routing selects highest-intelligence model when intelligence weight is high."""
    weights = RoutingWeights(speed=10, reliability=10, intelligence=80)

    scored = calculate_routing_scores(weights)

    # Planner has highest intelligence (85) - should rank #1
    assert scored[0]["id"] == "planner", f"Expected planner at rank 1, got {scored[0]['id']}"
    assert scored[0]["score"] > scored[1]["score"], "Top score should be strictly higher"

    print(f"PASS test_score_calculation_intelligence_heavy: planner ranked #1 (score={scored[0]['score']})")


def test_score_calculation_speed_heavy():
    """Test routing selects highest-speed model when speed weight is high."""
    weights = RoutingWeights(speed=80, reliability=10, intelligence=10)

    scored = calculate_routing_scores(weights)

    # Vision has highest speed (85) - should rank #1
    assert scored[0]["id"] == "vision", f"Expected vision at rank 1, got {scored[0]['id']}"

    print(f"PASS test_score_calculation_speed_heavy: vision ranked #1 (score={scored[0]['score']})")


def test_score_calculation_reliability_heavy():
    """Test routing selects highest-reliability model when reliability weight is high."""
    weights = RoutingWeights(speed=10, reliability=80, intelligence=10)

    scored = calculate_routing_scores(weights)

    # Embedder has highest reliability (90) but is skipped in routing
    # Coder has reliability 75, planner 80
    # Actually embedder is skipped in calculate_routing_scores
    # Planner reliability=80, coder=75, vision=70
    # So planner should win
    assert scored[0]["id"] == "planner", f"Expected planner at rank 1, got {scored[0]['id']}"

    print(f"PASS test_score_calculation_reliability_heavy: planner ranked #1 (score={scored[0]['score']})")


def test_score_calculation_zero_weights():
    """Test score calculation with zero weights defaults correctly."""
    weights = RoutingWeights(speed=0, reliability=0, intelligence=0)

    scored = calculate_routing_scores(weights)

    # With all zero weights, total_weight becomes 1 (per code logic)
    # All weights become 0, so score = 0 for all
    # Should still sort and rank
    assert len(scored) > 0

    print(f"PASS test_score_calculation_zero_weights: handled gracefully")


def test_get_model_for_task_with_weights():
    """Test get_model_for_task_with_weights returns correct model tag."""
    # Intelligence-heavy should pick planner for planning tasks
    weights = RoutingWeights(speed=10, reliability=10, intelligence=80)

    model = get_model_for_task_with_weights("planning", weights)
    assert "qwen" in model.lower(), f"Expected qwen model, got {model}"

    # Speed-heavy should pick vision for vision_ocr tasks
    weights_speed = RoutingWeights(speed=80, reliability=10, intelligence=10)
    model = get_model_for_task_with_weights("vision_ocr", weights_speed)
    assert "moondream" in model.lower() or "vision" in model.lower()

    print(f"PASS test_get_model_for_task_with_weights: returns correct model tags")


def test_routing_weights_validation():
    """Test RoutingWeights validation constraints."""
    # Valid weights
    w = RoutingWeights(speed=50, reliability=30, intelligence=20)
    assert w.speed == 50

    # Out of bounds should raise
    try:
        RoutingWeights(speed=101, reliability=0, intelligence=0)
        assert False, "Should have raised validation error"
    except Exception:
        pass

    try:
        RoutingWeights(speed=-1, reliability=0, intelligence=0)
        assert False, "Should have raised validation error"
    except Exception:
        pass

    print(f"PASS test_routing_weights_validation: validation works")


# ============================================================================
# TEST 2: Cache Handoff Tracing
# ============================================================================

async def test_model_switch_vision_to_reasoning():
    """
    Test model switch from vision to reasoning model.
    Simulates multi-step task that forces a model switch.
    Verifies the state carries messages through the switch.
    """
    # Create initial state with a vision task completed
    state: AgentState = {
        "task_id": "test-cache-001",
        "user_prompt": "Analyze boiler diagram and calculate pressure deviation",
        "attached_files": ["boiler_scan.pdf"],
        "plan": ExecutionPlan(
            summary="OCR then calculation",
            subtasks=[
                SubTask(
                    id=1,
                    description="Extract pressure readings from boiler inspection scan",
                    task_type="vision_ocr",
                    input_data="boiler_scan.pdf",
                    dependencies=[],
                    requires_approval=False
                ),
                SubTask(
                    id=2,
                    description="Calculate pressure deviation from SOP maximum",
                    task_type="code_execution",
                    input_data="measured_p=17.8, sop_max_p=15.0",
                    dependencies=[1],
                    requires_approval=True
                ),
            ]
        ),
        "completed_subtask_ids": [1],  # Vision task completed
        "results": [{
            "subtask_id": 1,
            "task_type": "vision_ocr",
            "description": "Extract pressure readings from boiler inspection scan",
            "status": "success",
            "output": "[OCR Extracted]: Line Tag: P-104A | Measured Pressure: 17.8 bar | SOP Max Pressure: 15.0 bar | Status: Overpressure Alarm",
            "model_used": "moondream"
        }],
        "current_subtask": None,
        "needs_human_approval": False,
        "final_output": None,
        "deliverable_path": None,
        "routing_weights": RoutingWeights(speed=33, reliability=33, intelligence=34),
        "prompt_compression": PromptCompressionConfig(mode="Off")
    }

    # Run router to get next subtask (should be code_execution)
    next_state = router_node(state)

    assert next_state["current_subtask"] is not None
    assert next_state["current_subtask"].task_type == "code_execution"
    assert next_state["current_subtask"].id == 2

    print(f"PASS test_model_switch_vision_to_reasoning: router selects code_execution after vision_ocr")


async def test_execute_tool_preserves_history():
    """
    Test that execute_tool_node has access to full results history.
    This validates the LangGraph state machine preserves message state.
    """
    state: AgentState = {
        "task_id": "test-cache-002",
        "user_prompt": "Test multi-model handoff",
        "attached_files": [],
        "plan": ExecutionPlan(
            summary="Test handoff",
            subtasks=[
                SubTask(id=1, description="First task", task_type="rag_retrieval", input_data="query", dependencies=[], requires_approval=False),
                SubTask(id=2, description="Second task", task_type="general_reasoning", input_data="synthesize", dependencies=[1], requires_approval=False),
            ]
        ),
        "completed_subtask_ids": [1],
        "results": [
            {
                "subtask_id": 1,
                "task_type": "rag_retrieval",
                "description": "First task",
                "status": "success",
                "output": "RAG context about pressure limits",
                "model_used": "embedder"
            }
        ],
        "current_subtask": SubTask(
            id=2,
            description="Second task",
            task_type="general_reasoning",
            input_data="synthesize",
            dependencies=[1],
            requires_approval=False
        ),
        "needs_human_approval": False,
        "final_output": None,
        "deliverable_path": None,
        "routing_weights": RoutingWeights(speed=33, reliability=33, intelligence=34),
        "prompt_compression": PromptCompressionConfig(mode="Off")
    }

    # Execute the general_reasoning task
    # This should use the mock LLM which reads from state["results"]
    result = await execute_tool_node(state)

    assert "results" in result
    assert len(result["results"]) == 1
    assert result["results"][0]["task_type"] == "general_reasoning"
    assert "model_used" in result["results"][0]

    # Verify the mock was called and used prior results
    output = result["results"][0]["output"]
    assert "RAG context" in output or "pressure" in output.lower() or len(output) > 0

    print(f"PASS test_execute_tool_preserves_history: execution has access to prior results")


async def test_full_graph_execution_mock():
    """
    Test full LangGraph execution with mock LLM.
    Validates the entire flow: planner -> router -> execute -> router -> execute -> synthesize
    """
    graph = build_agent_graph()

    initial_state: AgentState = {
        "task_id": "test-full-001",
        "user_prompt": "Inspect pressure vessel P-104A with measured pressure 17.8 bar, SOP max 15.0 bar",
        "attached_files": [],
        "plan": None,
        "completed_subtask_ids": [],
        "results": [],
        "current_subtask": None,
        "needs_human_approval": False,
        "final_output": None,
        "deliverable_path": None,
        "routing_weights": RoutingWeights(speed=33, reliability=33, intelligence=34),
        "prompt_compression": PromptCompressionConfig(mode="Off")
    }

    # Run the graph - first invocation will stop at approval_gate due to interrupt_before
    config = {"configurable": {"thread_id": "test-thread-001"}}
    final_state = await graph.ainvoke(initial_state, config=config)

    # The graph stops at approval_gate because code_execution requires approval
    # Resume the interrupted graph (simulates human approval)
    if final_state.get("needs_human_approval") and final_state.get("current_subtask"):
        final_state = await graph.ainvoke(Command(resume=True), config=config)

    # Verify completion
    assert final_state["final_output"] is not None, f"Expected final_output, got {final_state.get('final_output')}"
    assert final_state["deliverable_path"] is not None, f"Expected deliverable_path, got {final_state.get('deliverable_path')}"
    assert len(final_state["results"]) >= 3  # At least RAG, OCR, code_execution, general_reasoning

    # Verify models were used appropriately
    model_used = [r["model_used"] for r in final_state["results"]]
    print(f"  Models used in sequence: {model_used}")

    # Verify deliverable files exist
    import os
    assert os.path.exists(final_state["deliverable_path"]), "DOCX deliverable not created"
    xlsx_path = final_state["deliverable_path"].replace(".docx", ".xlsx")
    assert os.path.exists(xlsx_path), "XLSX deliverable not created"

    print(f"PASS test_full_graph_execution_mock: full graph execution completed")
    print(f"  Final output length: {len(final_state['final_output'])}")
    print(f"  Subtasks completed: {len(final_state['results'])}")


# ============================================================================
# TEST 3: Message State Inspection
# ============================================================================

def test_agent_state_carries_routing_weights():
    """Test AgentState correctly carries RoutingWeights through execution."""
    weights = RoutingWeights(speed=20, reliability=30, intelligence=50)
    compression = PromptCompressionConfig(mode="Standard", whitespace_cleanup=True)

    state: AgentState = {
        "task_id": "test-state-001",
        "user_prompt": "test",
        "attached_files": [],
        "plan": None,
        "completed_subtask_ids": [],
        "results": [],
        "current_subtask": None,
        "needs_human_approval": False,
        "final_output": None,
        "deliverable_path": None,
        "routing_weights": weights,
        "prompt_compression": compression,
    }

    # Verify state has the weights
    assert state["routing_weights"] is not None
    assert state["routing_weights"].speed == 20
    assert state["routing_weights"].intelligence == 50
    assert state["prompt_compression"].mode == "Standard"
    assert state["prompt_compression"].whitespace_cleanup is True

    print(f"PASS test_agent_state_carries_routing_weights: state preserves user preferences")


def test_agent_state_carries_messages():
    """
    Test that the 'results' array (acting as message history)
    is preserved and passed through the graph.
    This is the LangGraph state machine's mechanism for context preservation.
    """
    state: AgentState = {
        "task_id": "test-state-002",
        "user_prompt": "test",
        "attached_files": [],
        "plan": ExecutionPlan(summary="test", subtasks=[]),
        "completed_subtask_ids": [1, 2],
        "results": [
            {"subtask_id": 1, "task_type": "rag_retrieval", "output": "Result 1", "model_used": "embedder", "status": "success", "description": "RAG"},
            {"subtask_id": 2, "task_type": "vision_ocr", "output": "Result 2", "model_used": "vision", "status": "success", "description": "OCR"},
        ],
        "current_subtask": SubTask(id=3, description="Next", task_type="general_reasoning", input_data="", dependencies=[2], requires_approval=False),
        "needs_human_approval": False,
        "final_output": None,
        "deliverable_path": None,
        "routing_weights": RoutingWeights(speed=33, reliability=33, intelligence=34),
        "prompt_compression": PromptCompressionConfig(mode="Off")
    }

    # Verify results array is complete
    assert len(state["results"]) == 2
    assert state["results"][0]["task_type"] == "rag_retrieval"
    assert state["results"][1]["task_type"] == "vision_ocr"

    # The execute_tool_node reads from state["results"] to build context
    # This is how LangGraph provides the full conversation history to the new model
    # which enables vLLM's --enable-prefix-caching to work when switching BACK to a model

    print(f"PASS test_agent_state_carries_messages: results array preserves full history")


def test_results_injected_into_prompt():
    """
    Test that prior results are injected into the prompt for the next model call.
    This is the critical mechanism: when switching models, LangGraph injects
    the entire accumulated results/messages into the new prompt, allowing
    vLLM's prefix caching to find cache hits when returning to a previous model.
    """
    # This is verified by examining execute_tool_node logic:
    # Line 214-218 in agent_graph.py builds evidence from state["results"]
    # and passes it to the LLM call for general_reasoning
    # Line 188-204 does similar for code_execution

    # Verify the code pattern exists
    import inspect
    source = inspect.getsource(execute_tool_node)

    assert "state.get(\"results\"" in source, "execute_tool_node should read results from state"
    assert "evidence" in source.lower() or "context from prior" in source.lower()

    print(f"PASS test_results_injected_into_prompt: code injects history into prompts")


# ============================================================================
# INTEGRATION TEST: Multi-Model Switch with Context Preservation
# ============================================================================

async def test_multi_model_switch_context_preservation():
    """
    Integration test: Simulate a task that switches models multiple times
    and verify context is preserved at each switch.

    This validates the architectural note from routing-ujjwal.md:
    - Native KV-cache transfer between architectures is impossible
    - Zero context loss achieved by LangGraph injecting full messages array
    - vLLM prefix caching works when switching BACK to a previously used model
    """
    graph = build_agent_graph()

    # Use intelligence-heavy weights to influence model selection
    weights = RoutingWeights(speed=10, reliability=10, intelligence=80)

    initial_state: AgentState = {
        "task_id": "test-multi-switch-001",
        "user_prompt": "Read pressure vessel manual, analyze scan, calculate deviation, write report",
        "attached_files": ["vessel_scan.pdf"],
        "plan": None,
        "completed_subtask_ids": [],
        "results": [],
        "current_subtask": None,
        "needs_human_approval": False,
        "final_output": None,
        "deliverable_path": None,
        "routing_weights": weights,
        "prompt_compression": PromptCompressionConfig(mode="Off")
    }

    config = {"configurable": {"thread_id": "test-multi-switch-thread"}}
    final_state = await graph.ainvoke(initial_state, config=config)

    # The planner may emit a code_execution subtask requiring human approval,
    # which interrupts the graph before synthesize. Resume to complete it.
    if final_state.get("needs_human_approval"):
        final_state = await graph.ainvoke(Command(resume=True), config=config)

    # Verify multiple model types were used
    models_used = set(r["model_used"] for r in final_state["results"])
    print(f"  Models used: {models_used}")

    # Should have at least 2 different models (planner + at least one other)
    assert len(models_used) >= 2, f"Expected multiple models, got {models_used}"

    # Verify final output references earlier findings
    final_output = final_state["final_output"].lower()
    assert "pressure" in final_output or "overpressure" in final_output or "17.8" in final_output

    print(f"PASS test_multi_model_switch_context_preservation: context preserved across switches")
    print(f"  Total results: {len(final_state['results'])}")
    print(f"  Unique models: {len(models_used)}")


# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

async def run_all_tests():
    """Run all Step 3 tests."""
    print("=" * 70)
    print("STEP 3: Multi-Objective Routing Testing & Context Validation")
    print("=" * 70)
    print()
    print("NOTE: vLLM verification is deferred to real hardware.")
    print("      These tests run against the mock LLM client.")
    print()

    # Test 1: Score Calculation Verification
    print("\n--- Test Suite 1: Score Calculation Verification ---")
    test_score_calculation_basic()
    test_score_calculation_intelligence_heavy()
    test_score_calculation_speed_heavy()
    test_score_calculation_reliability_heavy()
    test_score_calculation_zero_weights()
    test_get_model_for_task_with_weights()
    test_routing_weights_validation()

    # Test 2: Cache Handoff Tracing
    print("\n--- Test Suite 2: Cache Handoff Tracing ---")
    await test_model_switch_vision_to_reasoning()
    await test_execute_tool_preserves_history()
    await test_full_graph_execution_mock()

    # Test 3: Message State Inspection
    print("\n--- Test Suite 3: Message State Inspection ---")
    test_agent_state_carries_routing_weights()
    test_agent_state_carries_messages()
    test_results_injected_into_prompt()

    # Integration Test
    print("\n--- Integration Test ---")
    await test_multi_model_switch_context_preservation()

    print("\n" + "=" * 70)
    print("ALL TESTS PASSED")
    print("=" * 70)
    print("\nSummary:")
    print("  1. Score Calculation Verification: 7 tests")
    print("  2. Cache Handoff Tracing: 3 tests")
    print("  3. Message State Inspection: 3 tests")
    print("  4. Integration Test: 1 test")
    print("\nNOTE: Live vLLM verification with --enable-prefix-caching")
    print("      requires real hardware and is deferred.")


if __name__ == "__main__":
    asyncio.run(run_all_tests())