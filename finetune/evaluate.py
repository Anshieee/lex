#!/usr/bin/env python3
"""
LEX fine-tuning evaluation — run on Colab (T4) after training.

Computes accuracy + per-class precision/recall/F1 for the BASE model and the
FINE-TUNED model on the held-out test set (tables never seen in training).

Usage (in the unsloth Colab notebook, after training):
    !pip install -q scikit-learn
    # save this file as /content/evaluate.py, then:
    #   python evaluate.py /content/test.json /content/base_model_dir
    #   python evaluate.py /content/test.json /content/merged_model_dir
"""
import json
import re
import sys
from collections import Counter

from sklearn.metrics import accuracy_score, classification_report, f1_score

LABELS = ["STRONG_GROWTH", "MODERATE_GROWTH", "MODERATE_DECLINE", "SEVERE_DECLINE"]
PROMPT_TMPL = (
    "You are a domain expert analyst for the Indian petroleum & natural gas sector.\n\n"
    "Below is an excerpt from the official \"Indian Petroleum & Natural Gas Statistics 2024-25\" "
    "(Government of India, Ministry of Petroleum and Natural Gas, Economic & Statistics Division). "
    "Table {tid}: {title} (figures in {unit}).\n\n"
    "{table_text}\n\n"
    "Task: Classify the year-over-year trend of \"{name}\" between FY{fy_prev} and FY{fy_curr} "
    "using the sector health thresholds:\n"
    "- STRONG_GROWTH: change greater than +5%\n"
    "- MODERATE_GROWTH: change between 0% and +5%\n"
    "- MODERATE_DECLINE: change between -5% and 0%\n"
    "- SEVERE_DECLINE: change less than -5%\n\n"
    "Respond with exactly one label: STRONG_GROWTH, MODERATE_GROWTH, MODERATE_DECLINE or SEVERE_DECLINE."
)


def extract_label(text: str):
    for lab in LABELS:
        if lab in text:
            return lab
    return "PREDICTION_FAILED"


def main():
    test_path, model_dir = sys.argv[1], sys.argv[2]
    samples = json.load(open(test_path))

    from transformers import AutoModelForCausalLM, AutoTokenizer
    import torch

    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForCausalLM.from_pretrained(
        model_dir, torch_dtype=torch.float16, device_map="cuda"
    )
    model.eval()

    y_true, y_pred = [], []
    for s in samples:
        prompt = s["messages"][0]["content"]
        messages = [{"role": "user", "content": prompt}]
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inp = tokenizer(text, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(**inp, max_new_tokens=16, do_sample=False)
        resp = tokenizer.decode(out[0][inp["input_ids"].shape[1]:], skip_special_tokens=True)
        y_true.append(s["messages"][1]["content"])
        y_pred.append(extract_label(resp))

    valid = [i for i, p in enumerate(y_pred) if p != "PREDICTION_FAILED"]
    print(f"\n=== {model_dir} ===")
    print(f"samples: {len(samples)}, valid predictions: {len(valid)} "
          f"({100*len(valid)/len(samples):.1f}%)")
    if valid:
        t, p = [y_true[i] for i in valid], [y_pred[i] for i in valid]
        print(f"accuracy: {accuracy_score(t, p):.4f}")
        print(f"macro F1: {f1_score(t, p, average='macro'):.4f}")
        print(classification_report(t, p, labels=LABELS, zero_division=0))
    print("prediction failures:", Counter(y_pred)["PREDICTION_FAILED"])


if __name__ == "__main__":
    main()
