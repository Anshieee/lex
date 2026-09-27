from pydantic import BaseModel, Field
from typing import List, Literal, Optional, Dict, Any


class RoutingWeights(BaseModel):
    """Dynamic routing weights for multi-objective model selection.

    All weights are integers 0-100. The router normalizes these to calculate
    a final priority score per model:

    Final Score = (w_speed * Speed) + (w_reliability * Reliability) + (w_intelligence * Intelligence)

    Where Speed, Reliability, Intelligence are the model's baseline scores (0-100)
    from the models.yaml registry.
    """
    speed: int = Field(
        ge=0, le=100, default=33,
        description="Weight for inference speed/latency optimization (0-100). Higher = prefer faster models."
    )
    reliability: int = Field(
        ge=0, le=100, default=33,
        description="Weight for reliability/uptime optimization (0-100). Higher = prefer more stable models."
    )
    intelligence: int = Field(
        ge=0, le=100, default=34,
        description="Weight for intelligence/capability optimization (0-100). Higher = prefer more capable models."
    )


class PromptCompressionConfig(BaseModel):
    """Configuration for prompt compression engines.

    Maps directly to the frontend compression settings modal. All toggles default
    to False (disabled) per the LEX adaptation guidance — users opt in to compression.
    """
    mode: Literal["Off", "Lossless", "Standard", "Aggressive"] = Field(
        default="Off",
        description="Overall compression mode. 'Off' disables all engines. 'Lossless' enables only lossless engines. 'Standard' enables balanced set. 'Aggressive' enables all engines including lossy."
    )
    # Lossless engines
    repeated_blocks: bool = Field(
        default=False,
        description="Deduplicate repeated text blocks across the conversation history."
    )
    whitespace_cleanup: bool = Field(
        default=False,
        description="Normalize and minimize whitespace in prompts."
    )
    json_tables: bool = Field(
        default=False,
        description="Compact JSON structures and tabular data (jsoncompact engine)."
    )
    # Lossy engines
    superseded_file_reads: bool = Field(
        default=False,
        description="Remove file read operations that were later superseded by newer reads (read-lifecycle engine)."
    )
    tool_output_filter: bool = Field(
        default=False,
        description="Filter verbose tool outputs to keep only essential results (toolfilter engine)."
    )
    relevance_filter: bool = Field(
        default=False,
        description="Remove older conversation turns deemed less relevant to current task (relevance engine)."
    )
    older_turns: bool = Field(
        default=False,
        description="Aggressively truncate older conversation turns beyond a recency window (aging engine)."
    )
    token_ceiling: bool = Field(
        default=False,
        description="Hard token budget ceiling — truncate to fit within max tokens (hard-budget engine)."
    )


class SubTask(BaseModel):
    id: int = Field(description="Unique incremental subtask index, starting at 1")
    description: str = Field(description="Clear explanation of the subtask")
    task_type: Literal["rag_retrieval", "vision_ocr", "code_execution", "general_reasoning"] = Field(
        description="Type of task to route to the appropriate tool or model"
    )
    input_data: str = Field(description="Exact input or query for this specific subtask")
    dependencies: List[int] = Field(
        default_factory=list,
        description="IDs of subtasks that must be completed before this one can run"
    )
    requires_approval: bool = Field(
        default=False,
        description="Set to True if this action runs code, modifies data, or finalizes documents"
    )


class ExecutionPlan(BaseModel):
    summary: str = Field(description="High-level explanation of how the user's request will be solved")
    subtasks: List[SubTask] = Field(description="Ordered list of structured subtasks")


class ToolExecutionResult(BaseModel):
    subtask_id: int
    task_type: str
    status: Literal["success", "failed", "pending_approval"]
    result_text: str
    error: Optional[str] = None