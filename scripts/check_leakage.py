#!/usr/bin/env python3
"""
Data Leakage Check for Fine-Tuning Pipeline

Verifies that evaluation prompts do not appear in training/validation data.
Checks for exact matches and high-similarity overlaps.
"""

import json
import sys
from pathlib import Path
from difflib import SequenceMatcher


def load_jsonl(filepath: Path):
    """Load JSONL file."""
    items = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                items.append(json.loads(line))
    return items


def load_json(filepath: Path):
    """Load JSON file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)


def similarity(a: str, b: str) -> float:
    """Calculate string similarity ratio."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def check_leakage(
    eval_file: Path,
    train_file: Path,
    val_file: Path,
    threshold: float = 0.85
) -> dict:
    """
    Check for data leakage between eval prompts and train/val data.
    
    Returns dict with results.
    """
    # Load eval prompts
    eval_data = load_json(eval_file)
    eval_prompts = [item.get("prompt", "") for item in eval_data]
    
    # Load train/val data
    train_data = load_jsonl(train_file) if train_file.exists() else []
    val_data = load_jsonl(val_file) if val_file.exists() else []
    
    # Extract instructions from train/val
    train_instructions = [item.get("instruction", "") for item in train_data]
    val_instructions = [item.get("instruction", "") for item in val_data]
    
    results = {
        "eval_prompts_checked": len(eval_prompts),
        "train_samples": len(train_instructions),
        "val_samples": len(val_instructions),
        "threshold": threshold,
        "exact_matches": [],
        "high_similarity": [],
        "leakage_found": False
    }
    
    # Check each eval prompt against train
    for i, eval_prompt in enumerate(eval_prompts):
        # Exact match check
        for j, train_inst in enumerate(train_instructions):
            if eval_prompt.strip() == train_inst.strip():
                results["exact_matches"].append({
                    "eval_id": eval_data[i].get("id", f"eval_{i}"),
                    "eval_prompt": eval_prompt[:200],
                    "train_index": j,
                    "train_instruction": train_inst[:200],
                    "set": "train"
                })
                results["leakage_found"] = True
        
        for j, val_inst in enumerate(val_instructions):
            if eval_prompt.strip() == val_inst.strip():
                results["exact_matches"].append({
                    "eval_id": eval_data[i].get("id", f"eval_{i}"),
                    "eval_prompt": eval_prompt[:200],
                    "val_index": j,
                    "val_instruction": val_inst[:200],
                    "set": "val"
                })
                results["leakage_found"] = True
        
        # High similarity check
        for j, train_inst in enumerate(train_instructions):
            sim = similarity(eval_prompt, train_inst)
            if sim >= threshold:
                results["high_similarity"].append({
                    "eval_id": eval_data[i].get("id", f"eval_{i}"),
                    "eval_prompt": eval_prompt[:200],
                    "train_index": j,
                    "train_instruction": train_inst[:200],
                    "similarity": round(sim, 4),
                    "set": "train"
                })
                results["leakage_found"] = True
        
        for j, val_inst in enumerate(val_instructions):
            sim = similarity(eval_prompt, val_inst)
            if sim >= threshold:
                results["high_similarity"].append({
                    "eval_id": eval_data[i].get("id", f"eval_{i}"),
                    "eval_prompt": eval_prompt[:200],
                    "val_index": j,
                    "val_instruction": val_inst[:200],
                    "similarity": round(sim, 4),
                    "set": "val"
                })
                results["leakage_found"] = True
    
    return results


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Check for data leakage in fine-tuning splits")
    parser.add_argument("--eval", default="data/fine_tuning/eval_prompts.json", help="Eval prompts file")
    parser.add_argument("--train", default="data/fine_tuning/train.jsonl", help="Train data file")
    parser.add_argument("--val", default="data/fine_tuning/val.jsonl", help="Val data file")
    parser.add_argument("--threshold", type=float, default=0.85, help="Similarity threshold (default: 0.85)")
    parser.add_argument("--output", default="data/fine_tuning/leakage_report.json", help="Output report file")
    
    args = parser.parse_args()
    
    eval_path = Path(args.eval)
    train_path = Path(args.train)
    val_path = Path(args.val)
    
    if not eval_path.exists():
        print(f"ERROR: Eval file not found: {eval_path}")
        return 1
    
    print(f"Checking leakage...")
    print(f"  Eval: {eval_path}")
    print(f"  Train: {train_path} ({'exists' if train_path.exists() else 'NOT FOUND'})")
    print(f"  Val: {val_path} ({'exists' if val_path.exists() else 'NOT FOUND'})")
    print(f"  Threshold: {args.threshold}")
    print()
    
    results = check_leakage(eval_path, train_path, val_path, args.threshold)
    
    # Print summary
    print(f"Eval prompts: {results['eval_prompts_checked']}")
    print(f"Train samples: {results['train_samples']}")
    print(f"Val samples: {results['val_samples']}")
    print(f"Exact matches: {len(results['exact_matches'])}")
    print(f"High similarity (>={args.threshold}): {len(results['high_similarity'])}")
    print(f"Leakage found: {results['leakage_found']}")
    print()
    
    if results["exact_matches"]:
        print("EXACT MATCHES:")
        for m in results["exact_matches"]:
            print(f"  Eval {m['eval_id']} == {m['set']}[{m.get('train_index', m.get('val_index'))}]")
            print(f"    \"{m['eval_prompt'][:100]}...\"")
    
    if results["high_similarity"]:
        print("HIGH SIMILARITY:")
        for m in results["high_similarity"]:
            print(f"  Eval {m['eval_id']} ~ {m['set']}[{m.get('train_index', m.get('val_index'))}] (sim={m['similarity']})")
            print(f"    Eval: \"{m['eval_prompt'][:80]}...\"")
            print(f"    {m['set'].capitalize()}: \"{m['train_instruction'][:80]}...\"")
    
    # Write detailed report
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nDetailed report saved to: {output_path}")
    
    return 1 if results["leakage_found"] else 0


if __name__ == "__main__":
    sys.exit(main())
