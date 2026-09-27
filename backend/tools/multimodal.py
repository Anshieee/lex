# backend/tools/multimodal.py
import os
import base64
import httpx
from PIL import Image
import pytesseract
from pypdf import PdfReader
from typing import Dict, Any
import tempfile

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


def render_pdf_to_images(file_path: str, dpi: int = 200) -> list[str]:
    """
    Render PDF pages to images for OCR/VLM processing.
    Uses pymupdf (fitz) if available, falls back to pdf2image.
    Returns list of temporary image file paths.
    """
    images = []
    try:
        # Try pymupdf (fitz) first - faster and no poppler dependency
        import fitz
        doc = fitz.open(file_path)
        for page_num in range(len(doc)):
            page = doc[page_num]
            # Render at specified DPI
            mat = fitz.Matrix(dpi / 72.0, dpi / 72.0)
            pix = page.get_pixmap(matrix=mat)

            # Save to temp file
            with tempfile.NamedTemporaryFile(suffix=f"_page{page_num}.png", delete=False) as tmp:
                pix.save(tmp.name)
                images.append(tmp.name)
        doc.close()
        return images
    except ImportError:
        pass

    try:
        # Fallback to pdf2image (requires poppler)
        from pdf2image import convert_from_path
        pages = convert_from_path(file_path, dpi=dpi)
        for i, page in enumerate(pages):
            with tempfile.NamedTemporaryFile(suffix=f"_page{i}.png", delete=False) as tmp:
                page.save(tmp.name, "PNG")
                images.append(tmp.name)
        return images
    except ImportError:
        raise RuntimeError(
            "Neither pymupdf (fitz) nor pdf2image is available. "
            "Install one: pip install pymupdf  # or  pip install pdf2image (requires poppler)"
        )

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
    temp_image_paths = []

    try:
        if ext == ".pdf":
            raw_text = extract_text_from_pdf(file_path)
            if len(raw_text) < 50:  # If PDF has little to no embedded text, it's a scan
                tier_used = "vlm_diagram" if is_diagram else "cpu_ocr"
                # Render PDF pages to images for OCR/VLM
                try:
                    image_paths = render_pdf_to_images(file_path)
                    temp_image_paths = image_paths

                    if is_diagram:
                        # For diagrams, use VLM on each page
                        results = []
                        for img_path in image_paths:
                            result = await extract_via_vlm(img_path)
                            results.append(result)
                        raw_text = "\n---\n".join(results)
                    else:
                        # For scanned text, use OCR on each page
                        results = []
                        for img_path in image_paths:
                            result = extract_text_via_ocr(img_path)
                            results.append(result)
                        raw_text = "\n---\n".join(results)

                        # If OCR quality is low, escalate to VLM
                        if len(raw_text) < 30:
                            tier_used = "vlm_fallback"
                            results = []
                            for img_path in image_paths:
                                result = await extract_via_vlm(img_path)
                                results.append(result)
                            raw_text = "\n---\n".join(results)
                except RuntimeError as e:
                    return {"status": "failed", "error": f"PDF rendering failed: {str(e)}"}
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
    finally:
        # Clean up temp image files
        for img_path in temp_image_paths:
            try:
                os.unlink(img_path)
            except Exception:
                pass

    # Pass extracted content through the security sanitizer
    safe_payload, attack_detected = sanitize_untrusted_text(raw_text, file_name)

    return {
        "status": "success",
        "file_name": file_name,
        "tier_used": tier_used,
        "attack_detected": attack_detected,
        "extracted_content": safe_payload
    }
