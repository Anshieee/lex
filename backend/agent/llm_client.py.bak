# backend/agent/llm_client.py
import json
import httpx
from typing import Type, TypeVar
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)
OLLAMA_BASE_URL = "http://127.0.0.1:11434"

async def call_local_llm(
    prompt: str,
    system_prompt: str = "You are a precise industrial engineering AI assistant.",
    model: str = "qwen2.5:7b-instruct-q4_K_M",
    response_schema: Optional[Type[T]] = None,
    temperature: float = 0.1
) -> Any:
    """Calls local Ollama instance with optional guided JSON schema enforcement."""
    payload = {
        "model": model,
        "system": system_prompt,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_ctx": 16384
        }
    }
    
    if response_schema:
        payload["format"] = "json"

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
        response.raise_for_status()
        raw_text = response.json().get("response", "")

    if response_schema:
        try:
            parsed_json = json.loads(raw_text)
            return response_schema.model_validate(parsed_json)
        except Exception as e:
            # Fallback/retry parsing
            print(f"[Schema Parsing Error] {e}. Raw response: {raw_text}")
            raise ValueError(f"LLM failed to output valid schema: {e}")

    return raw_text
