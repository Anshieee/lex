# backend/agent/model_registry.py
"""
Config-driven model registry for sovereign multi-model routing.
Add new models by appending to AVAILABLE_MODELS — no code changes needed.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import httpx

@dataclass
class ModelSpec:
    """Specification for a single locally-hosted model."""
    id: str
    ollama_tag: str
    display_name: str
    role: str
    task_types: List[str]
    state: str = "idle"  # "loaded" | "idle" | "unavailable"
    ctx_window: int = 4096
    temperature: float = 0.0

# ── Registry ─────────────────────────────────────────────────────────
# To add a new model: append a ModelSpec here, pull via `ollama pull <tag>`,
# and the router will automatically include it for matching task_types.

AVAILABLE_MODELS: List[ModelSpec] = [
    ModelSpec(
        id="planner",
        ollama_tag="qwen2.5:7b-instruct",
        display_name="Qwen 2.5 7B Instruct",
        role="Planner / Orchestrator / Synthesis",
        task_types=["planning", "general_reasoning"],
        ctx_window=4096,
    ),
    ModelSpec(
        id="conversational",
        ollama_tag="qwen2.5:3b",
        display_name="Qwen 2.5 3B Instruct",
        role="Fast Conversational Responses",
        task_types=["conversational"],
        ctx_window=4096,
    ),
    ModelSpec(
        id="coder",
        ollama_tag="qwen2.5:7b-instruct",
        display_name="Qwen 2.5 7B Instruct (Code Mode)",
        role="Code Generation & Verification",
        task_types=["code_execution"],
        ctx_window=4096,
    ),
    ModelSpec(
        id="vision",
        ollama_tag="moondream",
        display_name="Moondream 2 (VLM)",
        role="Multimodal / OCR / Diagram Analysis",
        task_types=["vision_ocr"],
    ),
    ModelSpec(
        id="embedder",
        ollama_tag="BAAI/bge-small-en-v1.5",
        display_name="BGE-Small EN v1.5 (CPU)",
        role="LanceDB SOP Retrieval",
        task_types=["rag_retrieval"],
        state="loaded",  # always loaded via sentence-transformers
    ),
    ModelSpec(
        id="sandbox",
        ollama_tag="gVisor / local-subprocess",
        display_name="Sandbox Runner",
        role="Isolated Code Execution",
        task_types=["code_execution"],
        state="loaded",
    ),
]

# ── Task-type → model routing ────────────────────────────────────────

# Default mapping: task_type → preferred model ollama_tag
_TASK_MODEL_MAP: Dict[str, str] = {}

def _build_routing_table():
    """Build the task_type → model tag routing from the registry."""
    global _TASK_MODEL_MAP
    _TASK_MODEL_MAP.clear()
    for spec in AVAILABLE_MODELS:
        for tt in spec.task_types:
            # Only map LLM-callable models (skip embedder and sandbox)
            if spec.id not in ("embedder", "sandbox"):
                if tt not in _TASK_MODEL_MAP:
                    _TASK_MODEL_MAP[tt] = spec.ollama_tag

_build_routing_table()


def get_model_for_task(task_type: str) -> str:
    """Return the Ollama model tag best suited for the given task_type."""
    return _TASK_MODEL_MAP.get(task_type, AVAILABLE_MODELS[0].ollama_tag)


def get_model_spec(model_id: str) -> Optional[ModelSpec]:
    """Look up a ModelSpec by its id."""
    for spec in AVAILABLE_MODELS:
        if spec.id == model_id:
            return spec
    return None


async def check_ollama_models() -> List[Dict]:
    """Probe Ollama for actually loaded/available models and update state."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get("http://127.0.0.1:11434/api/tags")
            res.raise_for_status()
            data = res.json()
            pulled_names = {m["name"] for m in data.get("models", [])}
    except Exception:
        pulled_names = set()

    result = []
    for spec in AVAILABLE_MODELS:
        # Embedder and sandbox are always available (not Ollama-based)
        if spec.id in ("embedder", "sandbox"):
            spec.state = "loaded"
        elif spec.ollama_tag in pulled_names or any(
            spec.ollama_tag.split(":")[0] in name for name in pulled_names
        ):
            spec.state = "loaded"
        else:
            spec.state = "unavailable"

        result.append({
            "id": spec.id,
            "name": spec.display_name,
            "ollama_tag": spec.ollama_tag,
            "role": spec.role,
            "task_types": spec.task_types,
            "state": spec.state,
        })
    return result
