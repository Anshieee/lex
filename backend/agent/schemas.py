from pydantic import BaseModel, Field
from typing import List, Literal, Optional, Dict, Any

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
