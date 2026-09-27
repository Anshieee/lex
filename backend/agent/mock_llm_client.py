"""
Mock LLM Client for Development/Testing

Provides OpenAI-compatible interface without requiring local models.
Used when Ollama/vLLM is not available in the development environment.

To use: Set environment variable USE_MOCK_LLM=1
Or import and call directly for testing.
"""

import json
import asyncio
import random
from typing import Type, TypeVar, Optional, Union
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


class MockLLMClientError(Exception):
    pass


# Predefined responses for different task types
MOCK_RESPONSES = {
    "planning": {
        "summary": "Analyze the industrial request and create execution plan with subtasks for RAG retrieval, OCR, and code execution.",
        "subtasks": [
            {
                "id": 1,
                "description": "Retrieve relevant SOP documents for pressure vessel inspection",
                "task_type": "rag_retrieval",
                "input_data": "OISD-STD-116 pressure vessel inspection requirements",
                "dependencies": [],
                "requires_approval": False
            },
            {
                "id": 2,
                "description": "Extract pressure readings from boiler inspection scan",
                "task_type": "vision_ocr",
                "input_data": "boiler_scan.pdf",
                "dependencies": [],
                "requires_approval": False
            },
            {
                "id": 3,
                "description": "Calculate pressure deviation from SOP maximum",
                "task_type": "code_execution",
                "input_data": "measured_p=17.8, sop_max_p=15.0",
                "dependencies": [1, 2],
                "requires_approval": True
            },
            {
                "id": 4,
                "description": "Synthesize findings into approval note",
                "task_type": "general_reasoning",
                "input_data": "Combine RAG, OCR, and calculation results",
                "dependencies": [3],
                "requires_approval": False
            }
        ]
    },
    "general_reasoning": "Based on the verified findings:\n\n1. **Executive Summary**: The inspection of boiler P-104A reveals an overpressure condition of 17.8 bar vs SOP maximum of 15.0 bar (+18.7% deviation).\n\n2. **Key Findings**: RAG retrieval confirms OISD-STD-116 requires immediate isolation at >10% deviation. OCR extraction verified measured pressure of 17.8 bar. Calculation confirms +18.7% deviation.\n\n3. **Safety Calculation**: Delta P = +2.8 bar. Deviation = +18.7%. Verdict: OVERPRESSURE VIOLATION.\n\n4. **Recommended Action**: Immediate isolation of P-104A. Initiate emergency depressurization per OISD-STD-116 Section 4.2. Schedule root cause analysis.",
    "code_execution": "```python\nmeasured_p = 17.8\nsop_max_p = 15.0\ntag = 'P-104A'\n\ndelta_p = measured_p - sop_max_p\npct_deviation = (delta_p / sop_max_p) * 100\n\nprint(f'[CALCULATION VERIFIED]')\nprint(f'Tag: {tag}')\nprint(f'Measured: {measured_p:.2f} bar | SOP Max: {sop_max_p:.2f} bar')\nprint(f'Delta P: {delta_p:+.2f} bar')\nprint(f'Deviation: {pct_deviation:+.1f}%')\n\nif delta_p > 0:\n    print('Verdict: OVERPRESSURE VIOLATION - Immediate isolation required.')\nelse:\n    print('Verdict: WITHIN OPERATING TOLERANCE.')\n```",
    "vision_ocr": "[OCR Extracted]: Line Tag: P-104A | Measured Pressure: 17.8 bar | SOP Max Pressure: 15.0 bar | Status: Overpressure Alarm | Timestamp: 2026-09-26 14:32:11",
    "rag_retrieval": "Retrieved context from OISD-STD-116:\n\nSection 4.2: Pressure Vessel Overpressure Response\n- At >10% deviation from certified working pressure: IMMEDIATE ISOLATION REQUIRED\n- Emergency depressurization per Section 4.2.1\n- Root cause analysis within 24 hours\n- Notification to Chief Inspector within 1 hour\n\nSection 3.1: Certified Working Pressure Limits\n- Class 1 vessels: Maximum 15.0 bar at design temperature\n- Safety valve set pressure: 16.5 bar (110% of CWP)\n\nReference: OISD-STD-116 Rev 3, 2021"
}


async def call_mock_llm(
    prompt: str,
    system_prompt: str = "You are an autonomous industrial task decomposition engine.",
    response_model: Optional[Type[T]] = None,
    model: str = "mock",
    temperature: float = 0.0,
) -> Union[str, T]:
    """
    Mock LLM call that returns predefined responses based on prompt content.
    Simulates realistic latency with random delay.
    """
    # Simulate network latency
    await asyncio.sleep(random.uniform(0.1, 0.5))

    # Determine response type from prompt
    prompt_lower = prompt.lower()

    if "execution plan" in prompt_lower or "planner" in system_prompt.lower():
        response_text = json.dumps(MOCK_RESPONSES["planning"])
    elif "synthesize" in prompt_lower or "approval note" in prompt_lower:
        response_text = MOCK_RESPONSES["general_reasoning"]
    elif "python code" in prompt_lower or "code generator" in system_prompt.lower():
        response_text = MOCK_RESPONSES["code_execution"]
    elif "ocr" in prompt_lower or "extract" in prompt_lower:
        response_text = MOCK_RESPONSES["vision_ocr"]
    elif "retrieve" in prompt_lower or "sop" in prompt_lower:
        response_text = MOCK_RESPONSES["rag_retrieval"]
    else:
        response_text = "Mock response for: " + prompt[:100]

    # If response_model is specified, validate and return parsed model
    if response_model is not None:
        try:
            return response_model.model_validate_json(response_text)
        except ValidationError as val_err:
            raise MockLLMClientError(
                f"Mock model output failed validation: {val_err}\nRaw output: {response_text}"
            ) from val_err

    return response_text


def is_mock_enabled() -> bool:
    """Check if mock LLM should be used."""
    import os
    return os.environ.get("USE_MOCK_LLM", "0") == "1"


# Drop-in replacement for call_local_llm that uses mock when enabled
async def call_local_llm_with_mock(
    prompt: str,
    system_prompt: str = "You are an autonomous industrial task decomposition engine. Follow schema rules strictly.",
    response_model: Optional[Type[T]] = None,
    model: str = "qwen2.5:7b",
    temperature: float = 0.0,
    max_retries: int = 3,
    retry_delay: float = 2.0,
) -> Union[str, T]:
    """
    Wrapper that uses mock LLM if USE_MOCK_LLM=1, otherwise falls back to real Ollama client.
    """
    if is_mock_enabled():
        return await call_mock_llm(prompt, system_prompt, response_model, model, temperature)

    # Import real client lazily to avoid circular imports
    from .llm_client import call_local_llm as real_call_local_llm
    return await real_call_local_llm(prompt, system_prompt, response_model, model, temperature, max_retries, retry_delay)


if __name__ == "__main__":
    # Test the mock client
    import asyncio

    async def test():
        from backend.agent.schemas import ExecutionPlan

        print("Testing mock LLM client...")
        plan = await call_mock_llm(
            prompt="Create execution plan for pressure vessel inspection",
            system_prompt="You are an industrial task planner.",
            response_model=ExecutionPlan
        )
        print(f"Plan: {plan.summary}")
        print(f"Subtasks: {len(plan.subtasks)}")
        for st in plan.subtasks:
            print(f"  {st.id}: {st.description} ({st.task_type})")

        # Test general reasoning
        text = await call_mock_llm(
            prompt="Synthesize findings",
            system_prompt="You are an industrial engineer."
        )
        print(f"\nReasoning: {text[:200]}...")

    asyncio.run(test())