# backend/tools/ingest.py
import os
from backend.tools.rag_engine import ingest_directory, ingest_pdf_file, tool_search_knowledge_base

def main():
    sops_dir = os.path.abspath("data/sample_documents/sops")
    os.makedirs(sops_dir, exist_ok=True)

    # If directory is empty, create a synthetic industrial SOP for immediate testing
    pdf_files = [f for f in os.listdir(sops_dir) if f.lower().endswith(".pdf")]
    
    if not pdf_files:
        print(f"No PDFs found in {sops_dir}. Generating synthetic test SOP: 'refinery_sop_402.pdf'...")
        from docx import Document
        # Generate via simple text document if pypdf / reportlab isn't installed
        test_sop_path = os.path.join(sops_dir, "refinery_sop_402.txt")
        with open(test_sop_path, "w") as f:
            f.write(
                "MRPL REFINERY STANDARD OPERATING PROCEDURE (SOP-402)\n"
                "Equipment: Boiler Feed Line P-104A and Crude Column C-101\n"
                "Operating Guidelines:\n"
                "- Maximum Certified Working Pressure: 15.2 bar.\n"
                "- Overpressure Alarm Threshold: 16.0 bar.\n"
                "- Critical Emergency Venting Trigger: 17.5 bar.\n"
                "- Operating Temperature Range: 180C to 240C.\n"
                "Mandatory Protocol: Any pressure reading exceeding 16.5 bar requires immediate isolation, "
                "re-calibration verification via code calculation, and formal Technical Approval Note issuance."
            )
        print(f"Synthetic SOP reference saved to {test_sop_path}")
        
        # Ingest directly into LanceDB via raw chunk
        from backend.tools.rag_engine import get_or_create_table, embed_model
        table = get_or_create_table()
        with open(test_sop_path) as f:
            text = f.read()
        vector = embed_model.encode(text).tolist()
        table.add([{
            "vector": vector,
            "text": text,
            "source": "refinery_sop_402.txt",
            "doc_type": "sop",
            "page_number": 1
        }])
        print("Synthesized SOP-402 directly indexed into LanceDB.")
    else:
        print(f"Ingesting PDFs from {sops_dir}...")
        results = ingest_directory(sops_dir, doc_type="sop")
        for fname, count in results.items():
            print(f"  Indexed '{fname}': {count} chunks")

    # Verify retrieval
    print("\n--- Verifying RAG Search ---")
    res = tool_search_knowledge_base("What is the maximum pressure limit for boiler line P-104A?")
    print("Status:", res["status"])
    print("Hits:", res["results_count"])
    print("Retrieved:\n", res["retrieved_context"])

if __name__ == "__main__":
    main()
