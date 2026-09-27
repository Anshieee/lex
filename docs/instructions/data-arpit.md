# Refinery Domain Data Preparation for Fine-Tuning — SIH 2026 LEX Workbench (Arpit)

**Goal:** prove the value of domain-specific fine-tuning for MRPL by fine-tuning one
model on authentic refinery/petrochemical data and demonstrating a measurable
improvement in its responses.

## 1. Data Sourcing & Downloading
Authentic, publicly available refinery and petrochemical data. Focus on:

- **OISD Standards (Oil Industry Safety Directorate):** public-domain OISD PDFs — these
  are the exact regulatory safety frameworks Indian refineries operate under.
  Prioritize standards directly related to the workbench's use cases:
  - OISD-STD-105 (Work Permit System)
  - OISD-STD-116 (Fire Protection Facilities for Petroleum Refineries)
  - OISD-STD-131 (Inspection of Boilers)
- **Hugging Face Inspection Datasets:** domain-specific safety/inspection data — e.g.
  `Tetrabot2026/InspecSafe-V1`, which contains safety inspection logs for oil/gas
  chemical scenarios (smoke, liquid accumulation, personnel safety gear violations).
- **Hugging Face SOP Datasets:** search the `oil-and-gas` tag; datasets like
  `Zekunli/SOPBench` contain rule-based operational constraints teaching the model to
  follow strict step-by-step procedures.
- **API / ASME Codes:** public or older open versions of API 510 (Pressure Vessel
  Inspection) and ASME Boiler and Pressure Vessel Codes.

## 2. Cleaning and Preprocessing
Normalize raw PDFs and varied dataset formats into strict instruction-response pairs.

- **Text Extraction & Stripping:** use `PyMuPDF` to extract text from OISD/API PDFs.
  Programmatically strip headers, footers, page numbers, and index pages so the model
  doesn't learn noise.
- **Synthetic QA Generation:** chunk cleaned manuals into sections, pass through a
  larger frontier model (70B+ class) to generate synthetic instruction-response pairs.
  Prompt the generator to act as a junior engineer asking technical questions based
  strictly on the provided text — e.g. "What is the acceptable pressure limit for a
  Class 1 boiler according to OISD-131?"
- **Formatting:** convert all Hugging Face data and synthetic QA pairs into standard
  ShareGPT or Alpaca JSONL format. Standard Alpaca entry:
  ```json
  {"instruction": "State the fire protection facility requirements for a petroleum refinery.", "input": "", "output": "According to OISD-STD-116..."}
  ```

## 3. Storage and Repository Layout
Consolidate everything into one standardized directory so the backend developer can
map the fine-tuning script to it directly.

- Root directory: `data/fine_tuning/`
- Unedited downloaded PDFs: `data/fine_tuning/raw/` (kept for auditing purposes)
- Shuffled/split cleaned JSONL: `data/fine_tuning/train.jsonl` (80%) and
  `data/fine_tuning/val.jsonl` (20%)

## 4. Benchmark Preparation (Before/After Proof)
To demonstrate fine-tuning success to hackathon judges, a held-out evaluation set is
required.

- Write 15-20 highly specific refinery engineering prompts based on the OISD standards
  — ones a base model typically answers with generic, non-compliant advice.
- Store in `data/fine_tuning/eval_prompts.json`.
- During the final demo, run these exact prompts through both the baseline model and
  the fine-tuned model side-by-side to visibly prove the fine-tuned version adheres
  strictly to MRPL/OISD industrial standards.

## Coordination note
This data pipeline is independent of the other three tracks (frontend, infra/sandbox,
backend routing) but its output directory structure (`data/fine_tuning/...`) should be
confirmed against whatever `backend/templates/` and `data/` layout the infra track
(Harshit) and backend track (Ujjwal) are already assuming, since the earlier codebase
audit found `data/sample_documents/`, `data/test_drawing_pid/`, and
`data/injection_tests/` as separate, currently-empty directories under the same `data/`
root — don't collide with those paths.
