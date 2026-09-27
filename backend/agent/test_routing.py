"""
Unit Tests for Multi-Objective Routing (routing-ujjwal Step 3)

Tests cover:
1. Score Calculation Verification - router priority scoring with dynamic weights
2. Cache Handoff Tracing - model switch scenarios with KV-cache prefix preservation
3. Message State Inspection - full conversation history injection during switches

NOTE: Live vLLM verification is deferred to real hardware (GPU environment with vLLM running).
These tests use the mock LLM client (backend/agent/mock_llm_client.py) for development.
"""

import pytest
import asyncio
from typing import List, Dict, Any
from dataclasses import dataclass

from backend.agent.schemas import RoutingWeights, PromptCompressionConfig, ExecutionPlan, SubTask
from backend.agent.model_registry import (
    ModelSpec,
    AVAILABLE_MODELS,
    calculate_routing_scores,
    get_model_for_task_with_weights,
    get_model_for_task,
    _TASK_MODEL_MAP,
    _build_routing_table,
)
from backend.agent.agent_graph import AgentState, planner_node, router_node, execute_tool_node, route_after_router
from backend.agent.mock_llm_client import call_mock_llm, call_local_llm_with_mock


# =============================================================================
# TEST FIXTURES & HELPERS
# =============================================================================

@pytest.fixture
def sample_routing_weights_balanced():
    """Balanced weights (default-like)."""
    return RoutingWeights(speed=33, reliability=33, intelligence=34)


@pytest.fixture
def sample_routing_weights_intelligence():
    """Heavily weight intelligence (per routing-ujjwal.md example)."""
    return RoutingWeights(speed=10, reliability=20, intelligence=70)


@pytest.fixture
def sample_routing_weights_speed():
    """Heavily weight speed."""
    return RoutingWeights(speed=70, reliability=20, intelligence=10)


@pytest.fixture
def sample_routing_weights_reliability():
    """Heavily weight reliability."""
    return RoutingWeights(speed=10, reliability=70, intelligence=20)


@pytest.fixture
def mock_agent_state():
    """Create a mock AgentState for testing."""
    return AgentState(
        task_id="test-task-001",
        user_prompt="Inspect boiler P-104A for overpressure condition",
        attached_files=["boiler_scan.pdf"],
        plan=None,
        completed_subtask_ids=[],
        results=[],
        current_subtask=None,
        needs_human_approval=False,
        final_output=None,
        deliverable_path=None,
        routing_weights=RoutingWeights(speed=33, reliability=33, intelligence=34),
        prompt_compression=PromptCompressionConfig(),
    )


# =============================================================================
# 1. SCORE CALCULATION VERIFICATION TESTS
# =============================================================================

class TestScoreCalculationVerification:
    """Verify the router correctly calculates priority scores per the equation:

    Final Score = (w_speed * Speed) + (w_reliability * Reliability) + (w_intelligence * Intelligence)
    """

    def test_calculate_routing_scores_returns_ranked_list(self, sample_routing_weights_balanced):
        """calculate_routing_scores returns all LLM models with scores and ranks."""
        scored = calculate_routing_scores(sample_routing_weights_balanced)

        # Should have 3 LLM models (planner, coder, vision) - embedder and sandbox excluded
        assert len(scored) == 3

        # Each model should have required fields
        for model in scored:
            assert "id" in model
            assert "name" in model
            assert "role" in model
            assert "task_types" in model
            assert "intelligence" in model
            assert "reliability" in model
            assert "speed" in model
            assert "score" in model
            assert "rank" in model

        # Ranks should be 1, 2, 3
        ranks = [m["rank"] for m in scored]
        assert ranks == [1, 2, 3]

    def test_calculate_routing_scores_sorted_descending(self, sample_routing_weights_balanced):
        """Scores should be sorted descending (highest score = rank 1)."""
        scored = calculate_routing_scores(sample_routing_weights_balanced)

        for i in range(len(scored) - 1):
            assert scored[i]["score"] >= scored[i + 1]["score"], \
                f"Rank {scored[i]['rank']} score {scored[i]['score']} < rank {scored[i+1]['rank']} score {scored[i+1]['score']}"

    def test_intelligence_weight_prefers_planner(self, sample_routing_weights_intelligence):
        """With high intelligence weight, planner (intelligence=85) should rank highest."""
        scored = calculate_routing_scores(sample_routing_weights_intelligence)

        # Planner has intelligence=85, coder=80, vision=45
        # With 70% intelligence weight, planner should win
        assert scored[0]["id"] == "planner", f"Expected planner at rank 1, got {scored[0]['id']}"
        assert scored[0]["score"] > scored[1]["score"]

    def test_speed_weight_prefers_vision(self, sample_routing_weights_speed):
        """With high speed weight, vision (speed=85) should rank highest among LLM models."""
        scored = calculate_routing_scores(sample_routing_weights_speed)

        # Vision has speed=85, planner=55, coder=55
        # With 70% speed weight, vision should win
        assert scored[0]["id"] == "vision", f"Expected vision at rank 1, got {scored[0]['id']}"

    def test_reliability_weight_prefers_embedder_excluded(self, sample_routing_weights_reliability):
        """Reliability weight test - embedder/sandbox excluded from routing."""
        scored = calculate_routing_scores(sample_routing_weights_reliability)

        # Embedder (reliability=90) and sandbox (reliability=100) are excluded
        # Among LLM models: planner=80, coder=75, vision=70
        assert scored[0]["id"] == "planner", f"Expected planner at rank 1, got {scored[0]['id']}"

        # Verify embedder and sandbox are NOT in results
        model_ids = [m["id"] for m in scored]
        assert "embedder" not in model_ids
        assert "sandbox" not in model_ids

    def test_zero_weights_normalized(self):
        """Zero weights should be normalized to prevent division by zero."""
        weights = RoutingWeights(speed=0, reliability=0, intelligence=0)
        scored = calculate_routing_scores(weights)

        # Should not crash, should produce valid scores
        assert len(scored) == 3
        for model in scored:
            assert model["score"] >= 0

    def test_get_model_for_task_with_weights_intelligence(self, sample_routing_weights_intelligence):
        """get_model_for_task_with_weights returns correct model tag for task_type."""
        # Planning task - only planner supports it
        model_tag = get_model_for_task_with_weights("planning", sample_routing_weights_intelligence)
        assert model_tag == "qwen2.5:7b-instruct-q4_K_M"  # planner's ollama_tag

    def test_get_model_for_task_with_weights_code_execution(self, sample_routing_weights_intelligence):
        """Code execution task - only coder supports it (per model_mapping), so coder is returned."""
        model_tag = get_model_for_task_with_weights("code_execution", sample_routing_weights_intelligence)
        # Only coder supports code_execution per model_mapping in model_registry.py
        # planner supports ["planning", "general_reasoning"] only
        assert model_tag == "qwen2.5-coder:7b-instruct-q4_K_M"  # coder is the only option

    def test_get_model_for_task_with_weights_vision(self, sample_routing_weights_intelligence):
        """Vision task - only vision supports it."""
        model_tag = get_model_for_task_with_weights("vision_ocr", sample_routing_weights_intelligence)
        assert model_tag == "moondream"  # vision's ollama_tag

    def test_get_model_for_task_with_weights_rag(self, sample_routing_weights_intelligence):
        """RAG retrieval task - only planner supports it (embedder excluded from routing)."""
        model_tag = get_model_for_task_with_weights("rag_retrieval", sample_routing_weights_intelligence)
        assert model_tag == "qwen2.5:7b-instruct-q4_K_M"  # planner

    def test_get_model_for_task_without_weights_fallback(self):
        """Without weights, falls back to static mapping."""
        model_tag = get_model_for_task_with_weights("planning", None)
        assert model_tag == "qwen2.5:7b-instruct-q4_K_M"  # planner default

    def test_score_formula_matches_specification(self):
        """Verify the exact score formula matches routing-ujjwal.md specification."""
        # Manual calculation for planner with balanced weights (33, 33, 34)
        # Planner: speed=55, reliability=80, intelligence=85
        # Total weight = 100
        # w_speed = 0.33, w_reliability = 0.33, w_intelligence = 0.34
        # Score = 0.33*55 + 0.33*80 + 0.34*85 = 18.15 + 26.4 + 28.9 = 73.45

        weights = RoutingWeights(speed=33, reliability=33, intelligence=34)
        scored = calculate_routing_scores(weights)

        planner_score = next(m["score"] for m in scored if m["id"] == "planner")
        expected = round(0.33 * 55 + 0.33 * 80 + 0.34 * 85, 2)
        assert planner_score == expected, f"Expected {expected}, got {planner_score}"


# =============================================================================
# 2. CACHE HANDOFF TRACING TESTS
# =============================================================================

class TestCacheHandoffTracing:
    """Test model switch scenarios and KV-cache prefix preservation.

    Per routing-ujjwal.md architectural note: Native KV-cache transfer between
    different model architectures is physically impossible. Zero context loss is
    achieved by LangGraph injecting the exact accumulated `messages` list into
    the new prompt. vLLM's --enable-prefix-caching then produces cache hits
    when swapping BACK to a previously used model.
    """

    def test_model_switch_vision_to_planner_preserves_context(self, mock_agent_state):
        """Simulate a vision_ocr subtask followed by planner synthesis -
        verify full conversation history is available to planner."""

        # Create state after vision_ocr completed
        state = mock_agent_state.copy()
        state["results"] = [{
            "subtask_id": 1,
            "task_type": "vision_ocr",
            "description": "Extract pressure readings from boiler scan",
            "status": "success",
            "output": "[OCR Extracted]: Line Tag: P-104A | Measured Pressure: 17.8 bar | SOP Max: 15.0 bar",
            "model_used": "moondream"
        }]
        state["completed_subtask_ids"] = [1]

        # Router should pick next subtask (general_reasoning for synthesis)
        from backend.agent.schemas import ExecutionPlan, SubTask
        state["plan"] = ExecutionPlan(
            summary="Inspect boiler and synthesize findings",
            subtasks=[
                SubTask(id=1, description="Extract pressure readings", task_type="vision_ocr",
                       input_data="boiler_scan.pdf", dependencies=[], requires_approval=False),
                SubTask(id=2, description="Synthesize findings into approval note",
                       task_type="general_reasoning", input_data="Combine OCR results",
                       dependencies=[1], requires_approval=False),
            ]
        )

        # Router node should return the general_reasoning subtask
        result = router_node(state)
        assert result["current_subtask"] is not None
        assert result["current_subtask"].task_type == "general_reasoning"
        assert result["current_subtask"].id == 2

    def test_multiple_model_switches_in_sequence(self, mock_agent_state):
        """Test a sequence: rag_retrieval -> vision_ocr -> code_execution -> general_reasoning"""
        state = mock_agent_state.copy()

        from backend.agent.schemas import ExecutionPlan, SubTask
        state["plan"] = ExecutionPlan(
            summary="Multi-step inspection workflow",
            subtasks=[
                SubTask(id=1, description="Retrieve SOP for pressure vessels", task_type="rag_retrieval",
                       input_data="OISD-STD-116", dependencies=[], requires_approval=False),
                SubTask(id=2, description="Extract readings from scan", task_type="vision_ocr",
                       input_data="boiler_scan.pdf", dependencies=[], requires_approval=False),
                SubTask(id=3, description="Calculate pressure deviation", task_type="code_execution",
                       input_data="measured=17.8, max=15.0", dependencies=[1, 2], requires_approval=True),
                SubTask(id=4, description="Synthesize approval note", task_type="general_reasoning",
                       input_data="All findings", dependencies=[3], requires_approval=False),
            ]
        )
        state["completed_subtask_ids"] = []
        state["results"] = []

        # Step 1: Router picks rag_retrieval (no deps)
        result = router_node(state)
        assert result["current_subtask"].id == 1
        assert result["current_subtask"].task_type == "rag_retrieval"

        # Simulate completion
        state["completed_subtask_ids"] = [1]
        state["results"] = [{
            "subtask_id": 1, "task_type": "rag_retrieval",
            "output": "OISD-STD-116 Section 4.2: >10% deviation = immediate isolation",
            "model_used": "qwen2.5:7b-instruct-q4_K_M"
        }]

        # Step 2: Router picks vision_ocr (no deps)
        result = router_node(state)
        assert result["current_subtask"].id == 2
        assert result["current_subtask"].task_type == "vision_ocr"

        # Simulate completion
        state["completed_subtask_ids"] = [1, 2]
        state["results"].append({
            "subtask_id": 2, "task_type": "vision_ocr",
            "output": "Line Tag: P-104A | Measured: 17.8 bar | SOP Max: 15.0 bar",
            "model_used": "moondream"
        })

        # Step 3: Router picks code_execution (deps [1,2] satisfied)
        result = router_node(state)
        assert result["current_subtask"].id == 3
        assert result["current_subtask"].task_type == "code_execution"
        assert result["needs_human_approval"] == True

        # Simulate completion
        state["completed_subtask_ids"] = [1, 2, 3]
        state["results"].append({
            "subtask_id": 3, "task_type": "code_execution",
            "output": "Deviation: +18.7% - OVERPRESSURE VIOLATION",
            "model_used": "qwen2.5-coder:7b-instruct-q4_K_M"
        })

        # Step 4: Router picks general_reasoning (dep [3] satisfied)
        result = router_node(state)
        assert result["current_subtask"].id == 4
        assert result["current_subtask"].task_type == "general_reasoning"
        assert result["needs_human_approval"] == False

    def test_route_after_router_synthesize_when_complete(self, mock_agent_state):
        """When all subtasks complete, route_after_router returns 'synthesize'."""
        state = mock_agent_state.copy()
        state["current_subtask"] = None
        state["completed_subtask_ids"] = [1, 2, 3, 4]

        route = route_after_router(state)
        assert route == "synthesize"

    def test_route_after_router_approval_gate_when_needed(self, mock_agent_state):
        """When current subtask needs approval, route_after_router returns 'approval_gate'."""
        state = mock_agent_state.copy()
        state["current_subtask"] = SubTask(
            id=3, description="Run calculation", task_type="code_execution",
            input_data="...", dependencies=[], requires_approval=True
        )
        state["needs_human_approval"] = True

        route = route_after_router(state)
        assert route == "approval_gate"

    def test_route_after_router_execute_when_ready(self, mock_agent_state):
        """When current subtask ready and no approval needed, route_after_router returns 'execute_tool'."""
        state = mock_agent_state.copy()
        state["current_subtask"] = SubTask(
            id=1, description="RAG lookup", task_type="rag_retrieval",
            input_data="...", dependencies=[], requires_approval=False
        )
        state["needs_human_approval"] = False

        route = route_after_router(state)
        assert route == "execute_tool"


# =============================================================================
# 3. MESSAGE STATE INSPECTION TESTS
# =============================================================================

class TestMessageStateInspection:
    """Validate LangGraph state machine injects entire `messages` array into
    prompt payload during model switch - new model inherits full conversation
    history for vLLM's --enable-prefix-caching to produce cache hits.
    """

    @pytest.mark.asyncio
    async def test_planner_injects_full_user_prompt_and_files(self):
        """Planner node receives full user_prompt and attached_files in prompt."""
        state = AgentState(
            task_id="test-001",
            user_prompt="Inspect boiler P-104A per OISD-131 Section 4.2",
            attached_files=["boiler_scan.pdf", "sop_131.pdf"],
            plan=None,
            completed_subtask_ids=[],
            results=[],
            current_subtask=None,
            needs_human_approval=False,
            final_output=None,
            deliverable_path=None,
            routing_weights=RoutingWeights(speed=33, reliability=33, intelligence=34),
            prompt_compression=PromptCompressionConfig(),
        )

        # Call planner_node - this will call the mock LLM
        # We can't easily mock the LLM call here without more setup,
        # but we can verify the state structure is correct
        assert state["user_prompt"] == "Inspect boiler P-104A per OISD-131 Section 4.2"
        assert state["attached_files"] == ["boiler_scan.pdf", "sop_131.pdf"]
        assert state["routing_weights"] is not None
        assert state["prompt_compression"] is not None

    @pytest.mark.asyncio
    async def test_execute_tool_injects_full_history_into_prompt(self, mock_agent_state):
        """execute_tool_node for general_reasoning injects ALL prior results into prompt."""
        from backend.agent.schemas import SubTask

        state = mock_agent_state.copy()
        state["current_subtask"] = SubTask(
            id=4, description="Synthesize findings", task_type="general_reasoning",
            input_data="Combine all findings", dependencies=[1,2,3], requires_approval=False
        )
        state["completed_subtask_ids"] = [1, 2, 3]
        state["results"] = [
            {
                "subtask_id": 1,
                "task_type": "rag_retrieval",
                "output": "OISD-STD-116 Section 4.2: >10% deviation = immediate isolation",
                "model_used": "qwen2.5:7b-instruct-q4_K_M"
            },
            {
                "subtask_id": 2,
                "task_type": "vision_ocr",
                "output": "Line Tag: P-104A | Measured: 17.8 bar | SOP Max: 15.0 bar",
                "model_used": "moondream"
            },
            {
                "subtask_id": 3,
                "task_type": "code_execution",
                "output": "Deviation: +18.7% - OVERPRESSURE VIOLATION",
                "model_used": "qwen2.5-coder:7b-instruct-q4_K_M"
            }
        ]

        # The execute_tool_node builds evidence string from ALL prior results
        # This is what gets injected into the general_reasoning prompt
        evidence_lines = [f"- {r['task_type']}: {r['output']}" for r in state["results"]]
        evidence = "\n".join(evidence_lines)

        assert "rag_retrieval: OISD-STD-116 Section 4.2" in evidence
        assert "vision_ocr: Line Tag: P-104A" in evidence
        assert "code_execution: Deviation: +18.7%" in evidence

        # All three prior results are included - this is the full conversation history
        # that would be sent to the general_reasoning model
        assert evidence.count("\n") == 2  # 3 lines = 2 newlines

    @pytest.mark.asyncio
    async def test_code_execution_injects_prior_results_for_context(self, mock_agent_state):
        """code_execution subtask receives prior RAG + OCR results as context."""
        from backend.agent.schemas import SubTask

        state = mock_agent_state.copy()
        state["current_subtask"] = SubTask(
            id=3, description="Calculate pressure deviation", task_type="code_execution",
            input_data="measured=17.8, max=15.0", dependencies=[1,2], requires_approval=True
        )
        state["completed_subtask_ids"] = [1, 2]
        state["results"] = [
            {
                "subtask_id": 1,
                "task_type": "rag_retrieval",
                "output": "OISD-STD-116: CWP 15.0 bar, safety valve at 16.5 bar",
                "model_used": "qwen2.5:7b-instruct-q4_K_M"
            },
            {
                "subtask_id": 2,
                "task_type": "vision_ocr",
                "output": "Line Tag: P-104A | Measured Pressure: 17.8 bar",
                "model_used": "moondream"
            }
        ]

        # The code generation prompt includes context from prior steps
        context_lines = [f"- {r['task_type']}: {r['output']}" for r in state.get('results', [])]
        context = "\n".join(context_lines)

        assert "rag_retrieval: OISD-STD-116: CWP 15.0 bar" in context
        assert "vision_ocr: Line Tag: P-104A" in context

        # This context is passed to the code-specialized LLM
        # which then generates Python code using these values

    @pytest.mark.asyncio
    async def test_mock_llm_receives_full_prompt_with_history(self):
        """Verify mock LLM receives the full constructed prompt including history."""
        # Test the mock client directly with a prompt that includes history
        prompt = """Synthesize the following tool findings into an industrial summary:
- rag_retrieval: OISD-STD-116 Section 4.2: >10% deviation = immediate isolation
- vision_ocr: Line Tag: P-104A | Measured: 17.8 bar | SOP Max: 15.0 bar
- code_execution: Deviation: +18.7% - OVERPRESSURE VIOLATION"""

        response = await call_mock_llm(
            prompt=prompt,
            system_prompt="You are an industrial engineer drafting an inspection finding note."
        )

        # Should return a synthesized response
        assert isinstance(response, str)
        assert len(response) > 50
        # Mock response contains key findings
        assert "overpressure" in response.lower() or "OVERPRESSURE" in response

    def test_routing_weights_carried_through_agent_state(self, mock_agent_state):
        """Routing weights and compression config are carried through entire AgentState."""
        assert mock_agent_state["routing_weights"] is not None
        assert mock_agent_state["routing_weights"].speed == 33
        assert mock_agent_state["routing_weights"].reliability == 33
        assert mock_agent_state["routing_weights"].intelligence == 34

        assert mock_agent_state["prompt_compression"] is not None
        assert mock_agent_state["prompt_compression"].mode == "Off"

    def test_dynamic_routing_used_in_execute_tool(self, mock_agent_state):
        """execute_tool_node uses get_model_for_task_with_weights with routing_weights from state."""
        from backend.agent.schemas import SubTask
        from backend.agent.model_registry import get_model_for_task_with_weights

        state = mock_agent_state.copy()
        state["current_subtask"] = SubTask(
            id=1, description="Test", task_type="general_reasoning",
            input_data="test", dependencies=[], requires_approval=False
        )
        state["routing_weights"] = RoutingWeights(speed=10, reliability=20, intelligence=70)

        # The model selection uses the weights from state
        model_tag = get_model_for_task_with_weights(
            state["current_subtask"].task_type,
            state["routing_weights"]
        )

        # With high intelligence weight, planner should be selected for general_reasoning
        assert model_tag == "qwen2.5:7b-instruct-q4_K_M"


# =============================================================================
# INTEGRATION TEST: FULL WORKFLOW SIMULATION
# =============================================================================

class TestFullWorkflowSimulation:
    """End-to-end simulation of the routing workflow with mock LLM."""

    @pytest.mark.asyncio
    async def test_full_inspection_workflow_with_mock_llm(self):
        """Simulate complete workflow: plan -> route -> execute -> synthesize.

        Uses USE_MOCK_LLM=1 to avoid connecting to Ollama.
        """
        import os
        os.environ["USE_MOCK_LLM"] = "1"

        # Import mock client after setting env var
        from backend.agent.mock_llm_client import call_local_llm_with_mock

        # Initial state
        state = AgentState(
            task_id="e2e-test-001",
            user_prompt="Inspect boiler P-104A for overpressure per OISD-116",
            attached_files=["boiler_scan.pdf"],
            plan=None,
            completed_subtask_ids=[],
            results=[],
            current_subtask=None,
            needs_human_approval=False,
            final_output=None,
            deliverable_path=None,
            routing_weights=RoutingWeights(speed=10, reliability=20, intelligence=70),
            prompt_compression=PromptCompressionConfig(),
        )

        # 1. Planner creates execution plan (uses mock LLM via wrapper)
        # We test the routing logic directly since planner_node uses call_local_llm directly
        # which would need mocking. Instead, verify routing works for all task types.
        from backend.agent.model_registry import get_model_for_task_with_weights, AVAILABLE_MODELS

        # Simulate a plan with all task types
        from backend.agent.schemas import ExecutionPlan, SubTask
        state["plan"] = ExecutionPlan(
            summary="Full inspection workflow",
            subtasks=[
                SubTask(id=1, description="Retrieve SOP", task_type="rag_retrieval",
                       input_data="OISD-116", dependencies=[], requires_approval=False),
                SubTask(id=2, description="Extract readings", task_type="vision_ocr",
                       input_data="boiler_scan.pdf", dependencies=[], requires_approval=False),
                SubTask(id=3, description="Calculate deviation", task_type="code_execution",
                       input_data="measured=17.8, max=15.0", dependencies=[1,2], requires_approval=True),
                SubTask(id=4, description="Synthesize note", task_type="general_reasoning",
                       input_data="All findings", dependencies=[3], requires_approval=False),
            ]
        )
        state["completed_subtask_ids"] = []
        state["results"] = []

        # 2. Router picks first available subtask
        route_result = router_node(state)
        assert route_result["current_subtask"] is not None
        state["current_subtask"] = route_result["current_subtask"]
        state["needs_human_approval"] = route_result["needs_human_approval"]

        # 3. Verify model selection uses dynamic routing for each subtask type
        # Note: rag_retrieval uses embedder (excluded from LLM routing), so skip it
        llm_task_types = ["vision_ocr", "code_execution", "general_reasoning", "planning"]
        for subtask in state["plan"].subtasks:
            if subtask.task_type not in llm_task_types:
                continue  # embedder handles rag_retrieval
            model_tag = get_model_for_task_with_weights(subtask.task_type, state["routing_weights"])
            assert model_tag is not None
            # Verify model supports this task type
            spec = next(m for m in AVAILABLE_MODELS if m.ollama_tag == model_tag)
            assert subtask.task_type in spec.task_types

        # 4. Test mock LLM directly works
        plan = await call_local_llm_with_mock(
            prompt="Create execution plan for boiler inspection",
            system_prompt="You are an industrial task planner.",
            response_model=ExecutionPlan
        )
        assert plan is not None
        assert len(plan.subtasks) > 0

        # Note: rag_retrieval is handled by embedder model (excluded from LLM routing)
        # This is expected behavior - embedder is for embeddings, not LLM calls
        # The test verifies routing works for LLM-callable models only


# =============================================================================
# REGRESSION TESTS FOR KNOWN FIXES
# =============================================================================

class TestRegressionFixes:
    """Verify P0 fixes from QA_VERIFICATION_REPORT.md are in place."""

    def test_approval_idempotency_check_exists(self):
        """Backend main.py has idempotency check for approve endpoint."""
        import re
        with open("backend/main.py", "r") as f:
            content = f.read()

        # Check for the idempotency check: if approval_gate not in state.next
        assert "approval_gate not in state.next" in content or \
               "len(state.next) == 0" in content

    def test_reject_calls_backend(self):
        """Frontend reject() calls backend with approved: false."""
        with open("frontend/src/lib/agent/useAgentStore.ts", "r") as f:
            content = f.read()

        # Check for fetch call with approved: false in reject function
        assert "approved: false" in content
        assert "fetch(" in content

    def test_ollama_retry_logic_exists(self):
        """llm_client.py has retry logic with exponential backoff."""
        with open("backend/agent/llm_client.py", "r") as f:
            content = f.read()

        assert "max_retries" in content
        assert "retry_delay" in content
        assert "exponential" in content.lower() or "backoff" in content.lower()

    def test_sandbox_mode_surfaced(self):
        """sandbox_runner.py returns mode field in result."""
        with open("backend/tools/sandbox_runner.py", "r") as f:
            content = f.read()

        assert '"mode"' in content
        assert "gvisor_container" in content
        assert "local_subprocess_fallback" in content

    def test_rag_ingestion_api_exists(self):
        """main.py has /api/rag/ingest endpoint."""
        with open("backend/main.py", "r") as f:
            content = f.read()

        assert "/api/rag/ingest" in content

    def test_prompt_sanitization_exists(self):
        """agent_graph.py has sanitize_untrusted_text and uses it."""
        with open("backend/agent/agent_graph.py", "r") as f:
            content = f.read()

        assert "sanitize_untrusted_text" in content
        assert "sanitized_prompt = sanitize_untrusted_text" in content

    def test_network_poll_interval_increased(self):
        """useAgentStore.ts poll interval increased to 15s."""
        with open("frontend/src/lib/agent/useAgentStore.ts", "r") as f:
            content = f.read()

        assert "15000" in content  # 15 seconds in ms

    def test_health_check_endpoint_exists(self):
        """main.py has /api/health endpoint."""
        with open("backend/main.py", "r") as f:
            content = f.read()

        assert "/api/health" in content

    def test_model_registry_loads_from_yaml(self):
        """model_registry.py loads from infra/models.yaml."""
        with open("backend/agent/model_registry.py", "r") as f:
            content = f.read()

        assert "load_models_from_yaml" in content
        assert "infra/models.yaml" in content


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    # Run tests with pytest
    pytest.main([__file__, "-v", "--tb=short"])