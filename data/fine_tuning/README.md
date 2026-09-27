# Refinery Domain Data Preparation for Fine-Tuning

## Goal
Prove the value of domain-specific fine-tuning for MRPL by fine-tuning one model on authentic refinery/petrochemical data and demonstrating measurable improvement in responses.

## Directory Structure
```
data/fine_tuning/
├── raw/                    # Unedited downloaded PDFs (for auditing)
├── train.jsonl             # 80% of cleaned data (Alpaca/ShareGPT format)
├── val.jsonl               # 20% of cleaned data (Alpaca/ShareGPT format)
├── eval_prompts.json       # 15-20 held-out evaluation prompts
└── README.md               # This file
```

## Data Sources (Priority Order)

### 1. OISD Standards (Oil Industry Safety Directorate)
Public-domain OISD PDFs — the exact regulatory safety frameworks Indian refineries operate under.

**Priority Standards:**
- OISD-STD-105: Work Permit System
- OISD-STD-116: Fire Protection Facilities for Petroleum Refineries
- OISD-STD-131: Inspection of Boilers

**Download:**
```bash
# These are publicly available from OISD website
# Manual download required - place in data/fine_tuning/raw/
```

### 2. Hugging Face Datasets
- `Tetrabot2026/InspecSafe-V1` — Safety inspection logs for oil/gas chemical scenarios
- `Zekunli/SOPBench` — Rule-based operational constraints (oil-and-gas tag)
- Search `oil-and-gas` tag for additional datasets

```python
from datasets import load_dataset
# ds = load_dataset("Tetrabot2026/InspecSafe-V1")
```

### 3. API / ASME Codes
- API 510 (Pressure Vessel Inspection) — public/older open versions
- ASME Boiler and Pressure Vessel Codes — public/older open versions

## Cleaning & Preprocessing Pipeline

### Step 1: Text Extraction (`scripts/extract_text.py`)
```python
import fitz  # PyMuPDF
import re

def extract_and_clean(pdf_path):
    doc = fitz.open(pdf_path)
    text = ""
    for page in doc:
        text += page.get_text()
    
    # Strip headers, footers, page numbers, index pages
    text = strip_boilerplate(text)
    return text

def strip_boilerplate(text):
    # Remove page numbers (standalone numbers on lines)
    text = re.sub(r'^\s*\d+\s*$', '', text, flags=re.MULTILINE)
    # Remove common headers/footers
    text = re.sub(r'OISD-STD-\d+.*?Page \d+', '', text)
    # Remove table of contents / index sections
    text = re.sub(r'Table of Contents.*?(?=\n\n|\Z)', '', text, flags=re.DOTALL)
    text = re.sub(r'Index.*?(?=\n\n|\Z)', '', text, flags=re.DOTALL)
    return text.strip()
```

### Step 2: Synthetic QA Generation (`scripts/generate_qa.py`)
```python
# Use a larger frontier model (70B+ class) to generate instruction-response pairs
# Prompt the generator to act as a junior engineer asking technical questions
# based strictly on the provided text

GENERATOR_PROMPT = """
You are a junior refinery engineer. Based ONLY on the provided text from 
OISD/ASME/API standards, generate 5-10 question-answer pairs.

Format each as:
{
  "instruction": "Specific technical question",
  "input": "",
  "output": "Answer citing exact standard section"
}

Rules:
- Questions must be answerable STRICTLY from provided text
- Cite section numbers (e.g., "Per OISD-STD-116 Section 4.2...")
- No external knowledge
- Technical precision required
"""
```

### Step 3: Format Conversion (`scripts/convert_format.py`)
Convert all data to standard Alpaca JSONL format:
```json
{"instruction": "State the fire protection facility requirements for a petroleum refinery.", "input": "", "output": "According to OISD-STD-116 Section 4.1..."}
```

### Step 4: Train/Val Split (`scripts/split_data.py`)
```python
import json
import random

with open("all_data.jsonl") as f:
    data = [json.loads(line) for line in f]

random.shuffle(data)
split_idx = int(len(data) * 0.8)
train_data = data[:split_idx]
val_data = data[split_idx:]

with open("train.jsonl", "w") as f:
    for item in train_data:
        f.write(json.dumps(item) + "\n")

with open("val.jsonl", "w") as f:
    for item in val_data:
        f.write(json.dumps(item) + "\n")
```

## Benchmark Preparation (`eval_prompts.json`)

15-20 highly specific refinery engineering prompts based on OISD standards — ones a base model typically answers with generic, non-compliant advice.

Example prompts:
1. "What is the acceptable pressure limit for a Class 1 boiler according to OISD-STD-131?"
2. "Per OISD-STD-116, what fire protection facilities are mandatory for a petroleum refinery processing >5 MMTPA?"
3. "Describe the work permit system workflow for hot work in a hydrocarbon area per OISD-STD-105."
4. "What is the required safety valve set pressure as a percentage of certified working pressure per API 510?"
5. "List the inspection intervals for pressure vessel internal/external inspection per OISD-STD-131."

## Usage for Fine-Tuning

```bash
# Example with Unsloth/LLaMA-Factory
# Train on train.jsonl, validate on val.jsonl
# Evaluate base vs fine-tuned on eval_prompts.json
```

## Coordination Notes
- This data pipeline is independent of other tracks (frontend, infra/sandbox, backend routing)
- Output directory `data/fine_tuning/` confirmed not colliding with existing `data/sample_documents/`, `data/test_drawing_pid/`, `data/injection_tests/`
- Backend/infra tracks can reference `eval_prompts.json` for benchmarking