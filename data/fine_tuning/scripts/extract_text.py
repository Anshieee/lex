#!/usr/bin/env python3
"""
Text Extraction & Cleaning for OISD/API/ASME PDFs

Uses PyMuPDF (fitz) to extract text from PDFs and strips boilerplate:
- Page numbers
- Headers/footers
- Table of contents
- Index pages

Output: Clean text files in data/fine_tuning/raw/extracted/
"""

import fitz  # PyMuPDF
import re
import os
import sys
from pathlib import Path


def strip_boilerplate(text: str) -> str:
    """Remove common boilerplate from extracted PDF text."""
    # Remove standalone page numbers (lines with only digits)
    text = re.sub(r'^\s*\d+\s*$', '', text, flags=re.MULTILINE)

    # Remove OISD-style headers/footers
    text = re.sub(r'OISD-STD-\d+.*?Page \d+', '', text)
    text = re.sub(r'OISD-RP-\d+.*?Page \d+', '', text)

    # Remove API/ASME headers
    text = re.sub(r'API (STD|RP|SPEC) \d+.*?Page \d+', '', text)
    text = re.sub(r'ASME (BPVC|B31\.\d).*?Page \d+', '', text)

    # Remove table of contents
    text = re.sub(r'(?i)table of contents.*?(?=\n\s*\n|\Z)', '', text, flags=re.DOTALL)
    text = re.sub(r'(?i)contents.*?(?=\n\s*\n|\Z)', '', text, flags=re.DOTALL)

    # Remove index sections
    text = re.sub(r'(?i)index.*?(?=\n\s*\n|\Z)', '', text, flags=re.DOTALL)

    # Remove revision history pages
    text = re.sub(r'(?i)revision history.*?(?=\n\s*\n|\Z)', '', text, flags=re.DOTALL)

    # Remove page headers like "1 | P a g e" or "Page 1 of 50"
    text = re.sub(r'^\s*Page \d+ of \d+\s*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\d+\s*\|\s*P\s*a\s*g\s*e\s*$', '', text, flags=re.MULTILINE)

    # Remove excessive whitespace (more than 2 consecutive newlines)
    text = re.sub(r'\n{3,}', '\n\n', text)

    # Remove lines that are just separators (---, ===, ***)
    text = re.sub(r'^\s*[-=_*]{3,}\s*$', '', text, flags=re.MULTILINE)

    return text.strip()


def extract_pdf(pdf_path: Path, output_dir: Path) -> Path:
    """Extract text from a single PDF and save cleaned version."""
    print(f"Extracting: {pdf_path.name}")

    doc = fitz.open(str(pdf_path))
    full_text = ""

    for page_num, page in enumerate(doc, 1):
        text = page.get_text()
        full_text += f"\n--- PAGE {page_num} ---\n{text}"

    doc.close()

    # Clean the extracted text
    cleaned = strip_boilerplate(full_text)

    # Save extracted text
    output_file = output_dir / f"{pdf_path.stem}_extracted.txt"
    output_file.write_text(cleaned, encoding='utf-8')

    print(f"  -> Saved: {output_file} ({len(cleaned)} chars)")
    return output_file


def main():
    raw_dir = Path(__file__).parent.parent / "raw"
    extracted_dir = Path(__file__).parent.parent / "raw" / "extracted"
    extracted_dir.mkdir(exist_ok=True)

    pdf_files = list(raw_dir.glob("*.pdf"))

    if not pdf_files:
        print("No PDF files found in raw/ directory.")
        print("Download OISD/API/ASME PDFs and place them in data/fine_tuning/raw/")
        return 1

    print(f"Found {len(pdf_files)} PDF file(s)")
    print(f"Output directory: {extracted_dir}")
    print()

    for pdf_path in pdf_files:
        try:
            extract_pdf(pdf_path, extracted_dir)
        except Exception as e:
            print(f"  ERROR extracting {pdf_path.name}: {e}")

    print("\nExtraction complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())