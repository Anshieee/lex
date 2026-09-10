# backend/tools/multimodal.py
import os
import base64
import httpx
from PIL import Image
import pytesseract
from pypdf import PdfReader
from typing import Dict, Any

from .sanitizer import sanitize_untrusted_text

OLLAMA_BASE_URL = "http://127.0.0.1:11434"

def extract_text_from_pdf(file_path: str) -> str:
    """Attempts native digital text extraction first."""
    try:
        reader = PdfReader(file_path)
        extracted = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                extracted.append(t)
        return "\n".join(extracted).strip()
    except Exception:
        return ""

def extract_text_via_ocr(image_path: str) -> str:
    """Tier 2: Fast CPU OCR for typed scan sheets."""
    try:
        img = Image.open(image_path)
        text = pytesseract.image_to_string(img)
        return text.strip()
    except Exception as e:
        print(f"[OCR Error] {e}")
        return ""

async def extract_via_vlm(image_path: str, prompt: str = "Transcribe all visible technical text, pressure/temperature readings, and equipment tags accurately.") -> str:
    """Tier 3: Local VLM (Moondream2 / Qwen2-VL) for P&ID schematics and handwriting."""
    with open(image_path, "rb") as img_file:
        encoded_img = base64.b64encode(img_file.read()).decode("utf-8")

    payload = {
        "model": "moondream",
        "prompt": prompt,
        "images": [encoded_img],
        "stream": False,
        "options": {"temperature": 0.0}
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
        res.raise_for_status()
        return res.json().get("response", "").strip()

async def tool_extract_document(file_path: str, is_diagram: bool = False) -> Dict[str, Any]:
    """
    Tiered document processing tool with prompt injection sanitization.
    Callable directly by Role 1 LangGraph agent.
    """
    if not os.path.exists(file_path):
        return {"status": "failed", "error": f"File not found: {file_path}"}

    file_name = os.path.basename(file_path)
    ext = os.path.splitext(file_name)[1].lower()
    raw_text = ""
    tier_used = "native_pdf"

    if ext == ".pdf":
        raw_text = extract_text_from_pdf(file_path)
        if len(raw_text) < 50:  # If PDF has little to no embedded text, it's a scan
            tier_used = "vlm_diagram" if is_diagram else "cpu_ocr"
            # Note: For multi-page PDF images in prod, render page to image first.
            raw_text = f"[Scanned PDF detected. Processed via {tier_used}]"
    elif ext in [".png", ".jpg", ".jpeg", ".bmp", ".tiff"]:
        if is_diagram:
            tier_used = "vlm_diagram"
            raw_text = await extract_via_vlm(file_path)
        else:
            tier_used = "cpu_ocr"
            raw_text = extract_text_via_ocr(file_path)
            if len(raw_text) < 30:  # OCR confidence low/empty -> escalate to VLM
                tier_used = "vlm_fallback"
                raw_text = await extract_via_vlm(file_path)
    else:
        return {"status": "failed", "error": f"Unsupported file extension: {ext}"}

    # Pass extracted content through the security sanitizer
    safe_payload, attack_detected = sanitize_untrusted_text(raw_text, file_name)

    return {
        "status": "success",
        "file_name": file_name,
        "tier_used": tier_used,
        "attack_detected": attack_detected,
        "extracted_content": safe_payload
    }
