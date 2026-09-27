# backend/agent/model_registry.py
"""
Config-driven model registry for sovereign multi-model routing.
Models loaded from infra/models.yaml — no code changes needed to add models.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import httpx
import yaml
from pathlib import Path

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
    # Multi-objective routing scores (0-100) - from models.yaml registry
    intelligence: int = 50
    reliability: int = 50
    speed: int = 50
    resident: bool = False
    vram_usage_mb: int = 0


def load_models_from_yaml() -> List[ModelSpec]:
    """Load model specifications from infra/models.yaml."""
    yaml_path = Path(__file__).parent.parent.parent / "infra" / "models.yaml"
    if not yaml_path.exists():
        # Fallback to hardcoded defaults if YAML not found
        return _get_default_models()

    with open(yaml_path, "r") as f:
        config = yaml.safe_load(f)

    models = []

    # Map YAML keys to internal model IDs and task types
    model_mapping = {
        "reasoning": {
            "id": "planner",
            "task_types": ["planning", "general_reasoning"],
        },
        "coder": {
            "id": "coder",
            "task_types": ["code_execution"],
        },
        "vision": {
            "id": "vision",
            "task_types": ["vision_ocr"],
        },
        "embeddings": {
            "id": "embedder",
            "task_types": ["rag_retrieval"],
        },
    }

    for yaml_key, mapping in model_mapping.items():
        if yaml_key in config.get("models", {}):
            m = config["models"][yaml_key]
            models.append(ModelSpec(
                id=mapping["id"],
                ollama_tag=m.get("name", ""),
                display_name=m.get("name", ""),
                role=m.get("role", ""),
                task_types=mapping["task_types"],
                ctx_window=m.get("context_length", 4096),
                intelligence=m.get("intelligence", 50),
                reliability=m.get("reliability", 50),
                speed=m.get("speed", 50),
                resident=m.get("resident", False),
                vram_usage_mb=m.get("vram_usage_mb", 0),
                state="loaded" if m.get("resident", False) else "idle",
            ))

    # Add sandbox as non-LLM model
    models.append(ModelSpec(
        id="sandbox",
        ollama_tag="gVisor / local-subprocess",
        display_name="Sandbox Runner",
        role="Isolated Code Execution",
        task_types=["code_execution"],
        state="loaded",
        intelligence=0,
        reliability=100,
        speed=100,
    ))

    return models


def _get_default_models() -> List[ModelSpec]:
    """Fallback hardcoded models if YAML not available."""
    return [
        ModelSpec(
            id="planner",
            ollama_tag="qwen2.5:7b-instruct-q4_K_M",
            display_name="Qwen 2.5 7B Instruct (Q4_K_M)",
            role="Planner / Orchestrator / Synthesis",
            task_types=["planning", "general_reasoning"],
            ctx_window=32768,
            intelligence=85,
            reliability=80,
            speed=55,
            resident=True,
            vram_usage_mb=4700,
        ),
        ModelSpec(
            id="coder",
            ollama_tag="qwen2.5-coder:7b-instruct-q4_K_M",
            display_name="Qwen 2.5 Coder 7B Instruct (Q4_K_M)",
            role="Code Generation & Verification",
            task_types=["code_execution"],
            ctx_window=32768,
            intelligence=80,
            reliability=75,
            speed=55,
            resident=False,
            vram_usage_mb=4700,
        ),
        ModelSpec(
            id="vision",
            ollama_tag="moondream",
            display_name="Moondream 2 (VLM)",
            role="Multimodal / OCR / Diagram Analysis",
            task_types=["vision_ocr"],
            ctx_window=8192,
            intelligence=45,
            reliability=70,
            speed=85,
            resident=False,
            vram_usage_mb=1700,
        ),
        ModelSpec(
            id="embedder",
            ollama_tag="BAAI/bge-small-en-v1.5",
            display_name="BGE-Small EN v1.5 (CPU)",
            role="LanceDB SOP Retrieval",
            task_types=["rag_retrieval"],
            state="loaded",
            intelligence=60,
            reliability=90,
            speed=95,
            resident=True,
            vram_usage_mb=0,
        ),
        ModelSpec(
            id="sandbox",
            ollama_tag="gVisor / local-subprocess",
            display_name="Sandbox Runner",
            role="Isolated Code Execution",
            task_types=["code_execution"],
            state="loaded",
            intelligence=0,
            reliability=100,
            speed=100,
        ),
    ]


# Load models from YAML config
AVAILABLE_MODELS: List[ModelSpec] = load_models_from_yaml()

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


def get_model_for_task_with_weights(task_type: str, weights: Optional["RoutingWeights"] = None) -> str:
    """Return the best model for a task type, optionally using dynamic routing weights.

    If weights are provided, calculate scores for all models supporting the task_type
    and return the highest-scoring one. Otherwise, fall back to static mapping.
    """
    if weights is None:
        return get_model_for_task(task_type)

    # Find all models that support this task_type
    candidate_specs = [spec for spec in AVAILABLE_MODELS
                       if task_type in spec.task_types and spec.id not in ("embedder", "sandbox")]

    if not candidate_specs:
        return get_model_for_task(task_type)

    # Calculate scores for candidates
    total_weight = weights.speed + weights.reliability + weights.intelligence
    if total_weight == 0:
        total_weight = 1

    w_speed = weights.speed / total_weight
    w_reliability = weights.reliability / total_weight
    w_intelligence = weights.intelligence / total_weight

    best_spec = max(candidate_specs, key=lambda spec: (
        w_speed * spec.speed +
        w_reliability * spec.reliability +
        w_intelligence * spec.intelligence
    ))

    return best_spec.ollama_tag


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
            "ctx_window": spec.ctx_window,
            "intelligence": spec.intelligence,
            "reliability": spec.reliability,
            "speed": spec.speed,
            "resident": spec.id in ("planner", "embedder", "sandbox"),  # planner + embedder + sandbox are resident
            "vram_usage_mb": 4700 if spec.id in ("planner", "coder") else 1700 if spec.id == "vision" else 0,
        })
    return result


def calculate_routing_scores(weights: "RoutingWeights") -> List[Dict]:
    """Calculate routing priority scores for all models based on user weights.

    Final Score = (w_speed * Speed) + (w_reliability * Reliability) + (w_intelligence * Intelligence)

    Returns list of models with calculated scores, sorted descending.
    """
    from .schemas import RoutingWeights

    scored_models = []
    for spec in AVAILABLE_MODELS:
        if spec.id in ("embedder", "sandbox"):
            continue  # Skip non-LLM models for routing

        # Calculate weighted score (weights are 0-100, model scores are 0-100)
        # Normalize weights to sum to 1.0 for fair comparison
        total_weight = weights.speed + weights.reliability + weights.intelligence
        if total_weight == 0:
            total_weight = 1

        w_speed = weights.speed / total_weight
        w_reliability = weights.reliability / total_weight
        w_intelligence = weights.intelligence / total_weight

        score = (
            w_speed * spec.speed +
            w_reliability * spec.reliability +
            w_intelligence * spec.intelligence
        )

        scored_models.append({
            "id": spec.id,
            "name": spec.display_name,
            "role": spec.role,
            "task_types": spec.task_types,
            "intelligence": spec.intelligence,
            "reliability": spec.reliability,
            "speed": spec.speed,
            "score": round(score, 2),
        })

    # Sort by score descending
    scored_models.sort(key=lambda x: x["score"], reverse=True)

    # Add rank
    for i, model in enumerate(scored_models):
        model["rank"] = i + 1

    return scored_models
