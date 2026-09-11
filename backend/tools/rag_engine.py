# backend/tools/rag_engine.py
import os
import lancedb
import pyarrow as pa
from sentence_transformers import SentenceTransformer
from pypdf import PdfReader
from typing import List, Dict, Any, Optional

DB_DIR = os.path.abspath("./data/lancedb_store")
os.makedirs(DB_DIR, exist_ok=True)

# FORCE CPU EXECUTION: Protects GPU VRAM for the 7B generative models
# Force offline local loading from cache to prevent egress / network hangs
# On first run, this will download the model (~33MB) then use cache afterwards.
try:
    embed_model = SentenceTransformer(
        "BAAI/bge-small-en-v1.5",
        device="cpu",
        model_kwargs={"local_files_only": True}
    )
except Exception:
    # First run: download and cache the model
    embed_model = SentenceTransformer(
        "BAAI/bge-small-en-v1.5",
        device="cpu",
    )

# Connect to embedded LanceDB
db = lancedb.connect(DB_DIR)

TABLE_SCHEMA = pa.schema([
    pa.field("vector", pa.list_(pa.float32(), 384)), # 384 dimensions for bge-small
    pa.field("text", pa.string()),
    pa.field("source", pa.string()),
    pa.field("doc_type", pa.string()),              # "sop", "manual", "inspection_standard"
    pa.field("page_number", pa.int32())
])

def get_or_create_table():
    try:
        return db.open_table("refinery_knowledge")
    except Exception:
        return db.create_table("refinery_knowledge", schema=TABLE_SCHEMA, mode="create")

knowledge_table = get_or_create_table()

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk = " ".join(words[i:i + chunk_size])
        if chunk.strip():
            chunks.append(chunk.strip())
    return chunks

def ingest_pdf_file(file_path: str, doc_type: str = "sop") -> int:
    """Chunks and embeds a single PDF into LanceDB using CPU."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Document not found at: {file_path}")

    reader = PdfReader(file_path)
    records = []
    file_name = os.path.basename(file_path)

    for page_idx, page in enumerate(reader.pages):
        raw_text = page.extract_text() or ""
        chunks = chunk_text(raw_text)
        for chunk in chunks:
            vector = embed_model.encode(chunk).tolist()
            records.append({
                "vector": vector,
                "text": chunk,
                "source": file_name,
                "doc_type": doc_type,
                "page_number": page_idx + 1
            })

    if records:
        table = get_or_create_table()
        table.add(records)
    return len(records)

def ingest_directory(dir_path: str, doc_type: str = "sop") -> Dict[str, int]:
    """Batch ingests all PDFs in a directory."""
    if not os.path.exists(dir_path):
        return {}
    
    results = {}
    for fname in os.listdir(dir_path):
        if fname.lower().endswith(".pdf"):
            full_path = os.path.join(dir_path, fname)
            count = ingest_pdf_file(full_path, doc_type=doc_type)
            results[fname] = count
    return results

def tool_search_knowledge_base(query: str, top_k: int = 3, doc_type: Optional[str] = None) -> Dict[str, Any]:
    """Agent tool interface for searching internal refinery SOPs."""
    table = get_or_create_table()
    
    # Check if table is empty
    if table.count_rows() == 0:
        return {
            "status": "warning",
            "query": query,
            "retrieved_context": "No documents ingested in LanceDB yet. Please ingest refinery SOPs.",
            "results_count": 0
        }

    query_vector = embed_model.encode(query).tolist()
    search_builder = table.search(query_vector).limit(top_k)
    
    if doc_type:
        search_builder = search_builder.where(f"doc_type = '{doc_type}'")

    hits = search_builder.to_list()
    
    formatted_passages = []
    for hit in hits:
        formatted_passages.append(
            f"--- [SOURCE: {hit['source']} | Page {hit['page_number']}] ---\n{hit['text']}"
        )

    context_str = "\n\n".join(formatted_passages) if formatted_passages else "No relevant SOP found."

    return {
        "status": "success",
        "query": query,
        "results_count": len(hits),
        "retrieved_context": context_str
    }
