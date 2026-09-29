# Fine-Tuning Data Sources

This document tracks all data sources used for the refinery domain fine-tuning pipeline.

## Primary Sources (OISD Standards)

| Source | Standard | Version | File | Pages | Extracted | Status |
|--------|----------|---------|------|-------|-----------|--------|
| OISD-STD-105 | Work Permit System | 2017 | ilide.info-oisd-std-105-pr_e79a5bb89126f5081f849a7e40e37329.pdf | ~150 | 47,614 chars | ✅ Extracted |
| OISD-STD-116 | Fire Protection Facilities for Petroleum Refineries | 2017 | fire protection system.pdf | ~80 | 17,551 chars | ✅ Extracted |
| OISD-STD-131 | Inspection of Boilers | 2017 | ilide.info-131-oisd-std-131-pr_acca82ab138b806300ed9e91d92f91f7.pdf | ~200 | 61,507 chars | ✅ Extracted |

## Secondary Sources

| Source | Standard | Version | File | Pages | Extracted | Status |
|--------|----------|---------|------|-------|-----------|--------|
| API 510 | Pressure Vessel Inspection (Pre-course Study Guide) | 2024 | ilide.info-api-510-pre-course-practical-study-guide-pdf-pr_c56ca145571947c19329124950074d73.pdf | ~50 | 2,698 chars | ✅ Extracted |

## Extraction Details

- **Tool**: `scripts/extract_text.py` using PyMuPDF (fitz)
- **Cleaning**: Boilerplate removal (page numbers, headers/footers, TOC, index, revision history)
- **Output**: `raw/extracted/{filename}_extracted.txt`
- **Encoding**: UTF-8
- **Chunk markers**: `--- PAGE N ---` preserved for reference

## Synthetic QA Generation

- **Tool**: `scripts/generate_qa.py` using 70B+ class model
- **Prompt**: Junior engineer persona, strict grounding in source text
- **Format**: Alpaca JSONL (`instruction`, `input`, `output`)
- **Citation requirement**: Every answer must cite exact standard and section

## Hugging Face Datasets (Available for Future Use)

| Dataset | Description | Relevance |
|---------|-------------|-----------|
| Tetrabot2026/InspecSafe-V1 | Safety inspection logs for oil/gas chemical scenarios | High |
| Zekunli/SOPBench | Rule-based operational constraints (oil-and-gas tag) | Medium |
| Various `oil-and-gas` tagged datasets | Additional domain data | TBD |

## Data Lineage

```
raw/*.pdf 
  → scripts/extract_text.py 
  → raw/extracted/*_extracted.txt 
  → scripts/generate_qa.py (with 70B+ model) 
  → synthetic_qa.jsonl 
  → scripts/convert_format.py (with HF datasets) 
  → train.jsonl (80%) + val.jsonl (20%)
  → Fine-tuning (Unsloth/LLaMA-Factory)
  → Evaluation on eval_prompts.json
```

## Quality Checks

- [ ] All extracted text files readable and non-empty
- [ ] No PDF passwords or encryption issues
- [ ] Boilerplate removal verified on sample pages
- [ ] Section references preserved in extracted text
- [ ] Synthetic QA cites exact standard sections
- [ ] Train/val split maintains standard distribution
- [ ] No eval prompt leakage into train/val
