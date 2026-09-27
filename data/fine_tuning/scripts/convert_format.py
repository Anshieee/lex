#!/usr/bin/env python3
"""
Format Converter for Fine-Tuning Data

Converts various input formats to standard Alpaca JSONL format:
{"instruction": "...", "input": "", "output": "..."}

Supports:
- Synthetic QA from generate_qa.py (already Alpaca format)
- Hugging Face datasets (InspecSafe-V1, SOPBench, etc.)
- Custom formats

Output: train.jsonl (80%) and val.jsonl (20%)
"""

import json
import random
import sys
from pathlib import Path
from typing import List, Dict, Any


ALPACA_KEYS = {"instruction", "input", "output"}


def is_alpaca_format(item: Dict) -> bool:
    """Check if item is already in Alpaca format."""
    return ALPACA_KEYS.issubset(item.keys())


def convert_inspecsafe(item: Dict) -> Dict:
    """Convert InspecSafe-V1 format to Alpaca."""
    # InspecSafe has: scenario, question, answer, category, etc.
    instruction = item.get("question", "")
    input_text = item.get("scenario", "")
    output = item.get("answer", "")

    if not instruction or not output:
        return None

    return {
        "instruction": instruction,
        "input": input_text,
        "output": output
    }


def convert_sopbench(item: Dict) -> Dict:
    """Convert SOPBench format to Alpaca."""
    # SOPBench has: procedure, steps, constraints, etc.
    instruction = item.get("task", item.get("instruction", ""))
    input_text = item.get("context", item.get("input", ""))
    output = item.get("response", item.get("output", ""))

    if not instruction or not output:
        return None

    return {
        "instruction": instruction,
        "input": input_text,
        "output": output
    }


def convert_generic(item: Dict) -> Dict:
    """Try to convert generic format to Alpaca."""
    # Try common key mappings
    instruction = (
        item.get("instruction") or
        item.get("question") or
        item.get("prompt") or
        item.get("task") or
        ""
    )
    input_text = (
        item.get("input") or
        item.get("context") or
        item.get("scenario") or
        ""
    )
    output = (
        item.get("output") or
        item.get("answer") or
        item.get("response") or
        item.get("completion") or
        ""
    )

    if not instruction or not output:
        return None

    return {
        "instruction": instruction,
        "input": input_text,
        "output": output
    }


def load_jsonl(filepath: Path) -> List[Dict]:
    """Load JSONL file."""
    items = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"Warning: Line {line_num} in {filepath} is invalid JSON: {e}")
    return items


def load_json(filepath: Path) -> List[Dict]:
    """Load JSON file (array of objects)."""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    elif isinstance(data, dict):
        return [data]
    else:
        return []


def convert_dataset(input_path: Path, format_type: str = "auto") -> List[Dict]:
    """Convert dataset from various formats to Alpaca."""
    print(f"Loading: {input_path} (format: {format_type})")

    if input_path.suffix == ".jsonl":
        raw_data = load_jsonl(input_path)
    elif input_path.suffix == ".json":
        raw_data = load_json(input_path)
    else:
        print(f"Unsupported file format: {input_path.suffix}")
        return []

    print(f"Loaded {len(raw_data)} raw items")

    converted = []
    for i, item in enumerate(raw_data):
        result = None

        if format_type == "inspecsafe" or (format_type == "auto" and "scenario" in item):
            result = convert_inspecsafe(item)
        elif format_type == "sopbench" or (format_type == "auto" and "procedure" in item):
            result = convert_sopbench(item)
        elif is_alpaca_format(item):
            result = item
        else:
            result = convert_generic(item)

        if result:
            converted.append(result)
        elif i < 5:  # Show first few failures
            print(f"  Failed to convert item {i}: keys={list(item.keys())}")

    print(f"Converted {len(converted)}/{len(raw_data)} items")
    return converted


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Convert datasets to Alpaca format and split train/val")
    parser.add_argument("inputs", nargs="+", help="Input files (JSONL or JSON)")
    parser.add_argument("--output-dir", default=".", help="Output directory for train.jsonl and val.jsonl")
    parser.add_argument("--format", choices=["auto", "inspecsafe", "sopbench", "alpaca"], default="auto", help="Input format")
    parser.add_argument("--train-ratio", type=float, default=0.8, help="Train split ratio (default: 0.8)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for shuffle")

    args = parser.parse_args()

    all_data = []

    for input_path_str in args.inputs:
        input_path = Path(input_path_str)
        if not input_path.exists():
            print(f"Warning: File not found: {input_path}")
            continue

        converted = convert_dataset(input_path, args.format)
        all_data.extend(converted)

    if not all_data:
        print("No data converted. Check input files and formats.")
        return 1

    # Shuffle and split
    random.seed(args.seed)
    random.shuffle(all_data)

    split_idx = int(len(all_data) * args.train_ratio)
    train_data = all_data[:split_idx]
    val_data = all_data[split_idx:]

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    train_file = output_dir / "train.jsonl"
    val_file = output_dir / "val.jsonl"

    # Write train.jsonl
    with open(train_file, 'w', encoding='utf-8') as f:
        for item in train_data:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')

    # Write val.jsonl
    with open(val_file, 'w', encoding='utf-8') as f:
        for item in val_data:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')

    print(f"\n{'='*50}")
    print(f"Total items: {len(all_data)}")
    print(f"Train: {len(train_data)} ({len(train_data)/len(all_data)*100:.1f}%)")
    print(f"Val: {len(val_data)} ({len(val_data)/len(all_data)*100:.1f}%)")
    print(f"Train file: {train_file}")
    print(f"Val file: {val_file}")
    print(f"{'='*50}")

    return 0


if __name__ == "__main__":
    sys.exit(main())