# backend/agent/llm_client.py
import json
import httpx
from dataclasses import dataclass, field
from pydantic import BaseModel, ValidationError
from typing import Type, TypeVar, Optional, Union

T = TypeVar("T", bound=BaseModel)

OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
DEFAULT_MODEL = "qwen2.5:7b"

class LLMClientError(Exception):
    pass


@dataclass
class LLMMetrics:
    """Token and timing metrics extracted from Ollama's response."""
    tokens_in: int = 0
    tokens_out: int = 0
    eval_tokens_per_sec: float = 0.0
    duration_ms: float = 0.0
    model: str = ""


@dataclass
class LLMResponse:
    """Wraps LLM output content alongside Ollama token metrics."""
    content: str = ""
    parsed: Optional[BaseModel] = None
    metrics: LLMMetrics = field(default_factory=LLMMetrics)


def _extract_metrics(data: dict, model: str) -> LLMMetrics:
    """Extract token metrics from Ollama's response JSON."""
    prompt_eval_count = data.get("prompt_eval_count", 0) or 0
    eval_count = data.get("eval_count", 0) or 0
    eval_duration_ns = data.get("eval_duration", 0) or 0
    total_duration_ns = data.get("total_duration", 0) or 0

    eval_tps = 0.0
    if eval_duration_ns > 0:
        eval_tps = eval_count / (eval_duration_ns / 1e9)

    return LLMMetrics(
        tokens_in=prompt_eval_count,
        tokens_out=eval_count,
        eval_tokens_per_sec=round(eval_tps, 2),
        duration_ms=round(total_duration_ns / 1e6, 1),
        model=model,
    )


async def _raw_ollama_call(
    prompt: str,
    system_prompt: str,
    response_model: Optional[Type[T]],
    model: str,
    temperature: float,
) -> dict:
    """Make the raw HTTP call to Ollama and return the full JSON response."""
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

    return res.json()


async def call_local_llm(
    prompt: str,
    system_prompt: str = "You are an autonomous industrial task decomposition engine. Follow schema rules strictly.",
    response_model: Optional[Type[T]] = None,
    model: str = DEFAULT_MODEL,
    temperature: float = 0.0,
) -> Union[str, T]:
    data = await _raw_ollama_call(prompt, system_prompt, response_model, model, temperature)
    message_content = data.get("message", {}).get("content", "").strip()

    if response_model is not None:
        try:
            return response_model.model_validate_json(message_content)
        except ValidationError as val_err:
            raise LLMClientError(
                f"Model output failed validation: {val_err}\nRaw output: {message_content}"
            ) from val_err

    return message_content


async def call_local_llm_with_metrics(
    prompt: str,
    system_prompt: str = "You are an autonomous industrial task decomposition engine. Follow schema rules strictly.",
    response_model: Optional[Type[T]] = None,
    model: str = DEFAULT_MODEL,
    temperature: float = 0.0,
) -> LLMResponse:
    """Like call_local_llm but returns an LLMResponse with full token metrics."""
    data = await _raw_ollama_call(prompt, system_prompt, response_model, model, temperature)
    message_content = data.get("message", {}).get("content", "").strip()
    metrics = _extract_metrics(data, model)

    response = LLMResponse(content=message_content, metrics=metrics)

    if response_model is not None:
        try:
            response.parsed = response_model.model_validate_json(message_content)
        except ValidationError as val_err:
            raise LLMClientError(
                f"Model output failed validation: {val_err}\nRaw output: {message_content}"
            ) from val_err

    return response


# ── Streaming API ────────────────────────────────────────────────────

async def stream_local_llm(
    prompt: str,
    system_prompt: str = "You are LEX, a sovereign on-premise AI assistant for industrial operations. You are helpful, concise, and technically precise.",
    model: str = DEFAULT_MODEL,
    temperature: float = 0.3,
):
    """
    Async generator that streams token-by-token from Ollama.

    Yields individual content strings as they arrive.
    After the final token, yields an LLMMetrics object with aggregated metrics.

    Usage:
        async for chunk in stream_local_llm("Hello"):
            if isinstance(chunk, LLMMetrics):
                # Final metrics
                print(f"Tokens: {chunk.tokens_out}, TPS: {chunk.eval_tokens_per_sec}")
            else:
                # Token string
                print(chunk, end="", flush=True)
    """
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": prompt},
    ]

    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": {
            "temperature": temperature,
            "num_ctx": 4096,
        },
    }

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            async with client.stream("POST", OLLAMA_URL, json=payload) as response:
                response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line.strip():
                        continue

                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    # Check if this is the final message with done=true
                    if data.get("done", False):
                        # Extract and yield final metrics
                        yield _extract_metrics(data, model)
                        return

                    # Extract token content
                    content = data.get("message", {}).get("content", "")
                    if content:
                        yield content

        except httpx.RequestError as exc:
            raise LLMClientError(f"Network error connecting to Ollama: {exc}") from exc
        except httpx.HTTPStatusError as exc:
            raise LLMClientError(f"Ollama returned HTTP {exc.response.status_code}: {exc.response.text}") from exc

