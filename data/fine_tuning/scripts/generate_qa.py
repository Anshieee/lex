#!/usr/bin/env python3
"""
Synthetic QA Generation for Refinery Domain Fine-Tuning

Uses a larger frontier model (70B+ class) to generate instruction-response pairs
from cleaned PDF text. The generator acts as a junior engineer asking technical
questions based STRICTLY on the provided text.

Requirements:
- OPENAI_API_KEY and OPENAI_BASE_URL for a 70B+ model
- Or local vLLM/Ollama with 70B+ model

Output: JSONL file with Alpaca-format entries
"""

import json
import os
import sys
import asyncio
from pathlib import Path
from typing import List, Dict
from openai import AsyncOpenAI


GENERATOR_SYSTEM_PROMPT = """You are an expert refinery engineer creating training data for a domain-specific LLM.

Given text from OISD, API, ASME, or other refinery standards, generate high-quality question-answer pairs that a junior engineer would ask.

RULES:
1. Questions MUST be answerable STRICTLY from the provided text - NO external knowledge
2. Each answer MUST cite the exact standard and section (e.g., "Per OISD-STD-116 Section 4.2...")
3. Generate 5-10 QA pairs per text chunk
4. Focus on: pressure limits, inspection intervals, safety procedures, material specs, compliance requirements
5. Format as JSON array of objects with: instruction, input, output

OUTPUT FORMAT (JSON array):
[
  {
    "instruction": "What is the maximum allowable working pressure for a Class 1 boiler per OISD-STD-131?",
    "input": "",
    "output": "Per OISD-STD-131 Section 3.2, the maximum allowable working pressure for a Class 1 boiler is 15.0 bar at design temperature."
  },
  ...
]"""

GENERATOR_USER_PROMPT = """Generate 5-10 question-answer pairs from the following refinery standard text.

Text source: {source_name}
Text chunk:
{text_chunk}

Return ONLY a valid JSON array of QA objects. No markdown, no explanation."""


async def generate_qa_for_chunk(
    client: AsyncOpenAI,
    model: str,
    source_name: str,
    text_chunk: str,
    temperature: float = 0.3
) -> List[Dict]:
    """Generate QA pairs for a single text chunk."""
    prompt = GENERATOR_USER_PROMPT.format(
        source_name=source_name,
        text_chunk=text_chunk[:8000]  # Limit chunk size
    )

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": GENERATOR_SYSTEM_PROMPT},
                {"role": "user", "content": prompt}
            ],
            temperature=temperature,
            max_tokens=4096,
        )

        content = response.choices[0].message.content.strip()

        # Parse JSON response
        try:
            qa_pairs = json.loads(content)
            if not isinstance(qa_pairs, list):
                raise ValueError("Response is not a JSON array")
            return qa_pairs
        except json.JSONDecodeError as e:
            print(f"  Warning: Failed to parse JSON from model: {e}")
            print(f"  Raw response: {content[:500]}...")
            return []

    except Exception as e:
        print(f"  Error generating QA: {e}")
        return []


def chunk_text(text: str, chunk_size: int = 4000, overlap: int = 500) -> List[str]:
    """Split text into overlapping chunks."""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunk = text[start:end]
        # Try to break at sentence boundary
        if end < len(text):
            last_period = chunk.rfind('.')
            if last_period > chunk_size * 0.5:
                end = start + last_period + 1
                chunk = text[start:end]
        chunks.append(chunk)
        start = end - overlap
    return chunks


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Generate synthetic QA from extracted PDF text")
    parser.add_argument("--input-dir", default="raw/extracted", help="Directory with extracted .txt files")
    parser.add_argument("--output", default="synthetic_qa.jsonl", help="Output JSONL file")
    parser.add_argument("--model", default="gpt-4o", help="Model to use for generation (70B+ recommended)")
    parser.add_argument("--base-url", default=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"), help="API base URL")
    parser.add_argument("--api-key", default=os.environ.get("OPENAI_API_KEY"), help="API key")
    parser.add_argument("--max-chunks", type=int, default=10, help="Max chunks per file (for testing)")

    args = parser.parse_args()

    if not args.api_key:
        print("ERROR: OPENAI_API_KEY not provided (env var or --api-key)")
        return 1

    input_dir = Path(__file__).parent.parent / args.input_dir
    output_file = Path(__file__).parent.parent / args.output

    if not input_dir.exists():
        print(f"ERROR: Input directory not found: {input_dir}")
        return 1

    txt_files = list(input_dir.glob("*.txt"))
    if not txt_files:
        print(f"No .txt files found in {input_dir}. Run extract_text.py first.")
        return 1

    print(f"Found {len(txt_files)} extracted text files")
    print(f"Using model: {args.model}")
    print(f"API base: {args.base_url}")
    print(f"Output: {output_file}")
    print()

    client = AsyncOpenAI(
        api_key=args.api_key,
        base_url=args.base_url
    )

    all_qa = []

    for txt_file in txt_files:
        print(f"\nProcessing: {txt_file.name}")
        text = txt_file.read_text(encoding='utf-8')
        chunks = chunk_text(text)
        print(f"  Split into {len(chunks)} chunks (max {args.max_chunks})")

        for i, chunk in enumerate(chunks[:args.max_chunks]):
            print(f"  Chunk {i+1}/{min(len(chunks), args.max_chunks)}...", end=" ")
            qa_pairs = await generate_qa_for_chunk(client, args.model, txt_file.stem, chunk)
            all_qa.extend(qa_pairs)
            print(f"generated {len(qa_pairs)} QA pairs")

    # Write output
    with open(output_file, 'w', encoding='utf-8') as f:
        for qa in all_qa:
            f.write(json.dumps(qa, ensure_ascii=False) + '\n')

    print(f"\n{'='*50}")
    print(f"Total QA pairs generated: {len(all_qa)}")
    print(f"Saved to: {output_file}")
    print(f"{'='*50}")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))