# backend/agent/intent_classifier.py
"""
Two-tier intent classifier for LEX.
Tier 1: Fast keyword/heuristic check (zero latency, catches ~80% of prompts).
Tier 2: LLM fallback for ambiguous prompts (uses the same Ollama model already in memory).
"""
import re
from dataclasses import dataclass
from typing import Literal, List, Optional

from .llm_client import call_local_llm, DEFAULT_MODEL


@dataclass
class IntentResult:
    """Result of intent classification."""
    intent: Literal["conversational", "agentic"]
    confidence: float  # 0.0–1.0
    method: str  # "heuristic" or "llm"


# ── Tier 1: Keyword Heuristics ───────────────────────────────────────

# Greeting patterns (case-insensitive)
_GREETING_PATTERNS = re.compile(
    r"^\s*(?:hi|hello|hey|howdy|yo|sup|good\s+(?:morning|afternoon|evening|day)|"
    r"greetings|namaste|what'?s?\s+up)\s*[!?.]*\s*$",
    re.IGNORECASE,
)

# Meta-questions about the system itself
_META_PATTERNS = re.compile(
    r"(?:what\s+(?:can|do)\s+you\s+do|"
    r"who\s+are\s+you|"
    r"how\s+(?:does|do)\s+(?:this|you)\s+work|"
    r"help\s*$|"
    r"what\s+(?:is|are)\s+(?:your|lex)\s+capabilit|"
    r"tell\s+me\s+about\s+yourself|"
    r"what\s+(?:is|'s)\s+lex)",
    re.IGNORECASE,
)

# Action verbs that strongly signal agentic intent
_AGENTIC_VERBS = re.compile(
    r"\b(?:analyze|analyse|generate|create|draft|calculate|compute|inspect|compare|"
    r"evaluate|assess|review|extract|process|scan|verify|validate|check|build|"
    r"produce|compile|prepare|write\s+(?:a|an|the)\s+(?:report|note|document|summary)|"
    r"approval\s+note|deliverable|document)\b",
    re.IGNORECASE,
)

# File-related references that signal agentic intent
_FILE_SIGNALS = re.compile(
    r"\b(?:\.docx|\.xlsx|\.pdf|\.csv|\.png|\.jpg|boiler|inspection|report|"
    r"p&id|diagram|sop|manual|certificate|scan|attachment|upload)\b",
    re.IGNORECASE,
)

# Simple Q&A patterns (conversational)
_SIMPLE_QA = re.compile(
    r"^(?:what\s+(?:is|are|was|were)|"
    r"how\s+(?:to|does|do|is|are|can)|"
    r"why\s+(?:is|are|does|do|did)|"
    r"when\s+(?:is|are|does|do|did|was|were)|"
    r"where\s+(?:is|are|does|do)|"
    r"can\s+you\s+(?:explain|tell|describe|clarify)|"
    r"explain\s+|"
    r"describe\s+|"
    r"define\s+|"
    r"tell\s+me\s+(?:about|what))",
    re.IGNORECASE,
)


def _heuristic_classify(prompt: str, has_files: bool) -> Optional[IntentResult]:
    """
    Tier 1: Fast keyword-based classification.
    Returns IntentResult if confident, None if ambiguous.
    """
    stripped = prompt.strip()
    word_count = len(stripped.split())

    # ── Strong conversational signals ────────────────────────────────

    # Pure greeting
    if _GREETING_PATTERNS.match(stripped):
        return IntentResult(intent="conversational", confidence=0.98, method="heuristic")

    # Meta-question about the system
    if _META_PATTERNS.search(stripped) and word_count < 15:
        return IntentResult(intent="conversational", confidence=0.95, method="heuristic")

    # ── Strong agentic signals ───────────────────────────────────────

    # Files attached → almost certainly agentic
    if has_files:
        return IntentResult(intent="agentic", confidence=0.95, method="heuristic")

    # Action verbs present
    if _AGENTIC_VERBS.search(stripped):
        return IntentResult(intent="agentic", confidence=0.90, method="heuristic")

    # File-related keywords
    if _FILE_SIGNALS.search(stripped):
        return IntentResult(intent="agentic", confidence=0.85, method="heuristic")

    # ── Likely conversational ────────────────────────────────────────

    # Short prompt with no action verbs → conversational
    if word_count <= 12 and not _AGENTIC_VERBS.search(stripped):
        # Simple Q&A pattern
        if _SIMPLE_QA.match(stripped):
            return IntentResult(intent="conversational", confidence=0.85, method="heuristic")
        # Very short → conversational
        if word_count <= 6:
            return IntentResult(intent="conversational", confidence=0.80, method="heuristic")

    # ── Ambiguous — fall through to Tier 2 ───────────────────────────
    return None


# ── Tier 2: LLM Fallback ────────────────────────────────────────────

_CLASSIFIER_SYSTEM_PROMPT = """\
You are an intent classifier for an industrial AI workbench called LEX.

Classify the user's message into exactly one of two categories:
- "conversational": The user is chatting, asking a question, seeking an explanation, \
or making small talk. No document generation or file processing is needed.
- "agentic": The user wants you to perform a complex task that involves analyzing files, \
running calculations, generating documents (.docx, .xlsx), or executing a multi-step workflow.

Respond with ONLY the single word: conversational OR agentic
Do not include any other text, explanation, or punctuation."""


async def _llm_classify(prompt: str) -> IntentResult:
    """
    Tier 2: Use the local LLM to classify ambiguous prompts.
    """
    try:
        result = await call_local_llm(
            prompt=f"Classify this user message:\n\n\"{prompt}\"",
            system_prompt=_CLASSIFIER_SYSTEM_PROMPT,
            model=DEFAULT_MODEL,
            temperature=0.0,
        )
        cleaned = result.strip().lower().rstrip(".")
        if "agentic" in cleaned:
            return IntentResult(intent="agentic", confidence=0.75, method="llm")
        else:
            return IntentResult(intent="conversational", confidence=0.75, method="llm")
    except Exception:
        # If LLM call fails, default to agentic (safer — won't miss a task)
        return IntentResult(intent="agentic", confidence=0.50, method="llm_fallback")


# ── Public API ───────────────────────────────────────────────────────

async def classify_intent(prompt: str, attached_files: Optional[List[str]] = None) -> IntentResult:
    """
    Classify user intent as 'conversational' or 'agentic'.

    Uses a fast keyword heuristic first, falling back to a lightweight
    LLM call only for ambiguous prompts.
    """
    has_files = bool(attached_files and len(attached_files) > 0)

    # Tier 1: heuristic
    result = _heuristic_classify(prompt, has_files)
    if result is not None:
        return result

    # Tier 2: LLM fallback
    return await _llm_classify(prompt)
