# backend/agent/llm_client.py
import json
import httpx
from pydantic import BaseModel, ValidationError
from typing import Type, TypeVar, Optional, Union

T = TypeVar("T", bound=BaseModel)

OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
DEFAULT_MODEL = "qwen2.5:7b-instruct-q4_K_M"

class LLMClientError(Exception):
    pass

async def call_local_llm(
    prompt: str,
    system_prompt: str = "You are an autonomous industrial task decomposition engine. Follow schema rules strictly.",
    response_model: Optional[Type[T]] = None,
    model: str = DEFAULT_MODEL,
    temperature: float = 0.0,
) -> Union[str, T]:
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": prompt},
    ]

    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_ctx": 4096,
        },
    }

    # Pass JSON format instruction
    if response_model is not None:
        payload["format"] = response_model.model_json_schema()

    # Bump timeout to 300s to accommodate local CPU inference
    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            res = await client.post(OLLAMA_URL, json=payload)
            res.raise_for_status()
        except httpx.RequestError as exc:
            raise LLMClientError(f"Network error connecting to Ollama: {exc}") from exc
        except httpx.HTTPStatusError as exc:
            raise LLMClientError(f"Ollama returned HTTP {exc.response.status_code}: {exc.response.text}") from exc

    data = res.json()
    message_content = data.get("message", {}).get("content", "").strip()

    if response_model is not None:
        try:
            return response_model.model_validate_json(message_content)
        except ValidationError as val_err:
            raise LLMClientError(
                f"Model output failed validation: {val_err}\nRaw output: {message_content}"
            ) from val_err

    return message_content
