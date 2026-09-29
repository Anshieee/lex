#!/usr/bin/env python3
"""
LEX fine-tuning dataset builder.

Source: "Indian Petroleum & Natural Gas Statistics 2024-25"
(Government of India, Ministry of Petroleum & Natural Gas,
 Economic & Statistics Division) — image-based PDF, OCR'd with Tesseract.

Task: 4-class year-over-year trend classification of sector indicators,
using documented business-rule thresholds (mirrors the NORMAL/WARNING/
OVERPRESSURE/CRITICAL status scheme of the LEX workbench).

Pipeline:
  1. Read per-page OCR text (.tmp_analysis/ocr/page_NNN.txt)
  2. Extract table rows: entity name + 6 yearly figures (+ optional change %)
  3. Self-validate rows: where the report prints its own change %, the
     computed change from OCR'd figures must agree within 1.5 pp
  4. Generate one sample per (row, year-pair) from the full table context
  5. Table-level 80/20 train/test split (test tables unseen in training)
  6. Emit finetune/data/train.json, test.json (chat format for unsloth)

No GPU required. Run:  venv/bin/python finetune/build_dataset.py
"""
import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OCR_DIR = ROOT / ".tmp_analysis" / "ocr"
OUT_DIR = ROOT / "finetune" / "data"

# Sector health thresholds (business rules, documented in the PPT)
THRESHOLDS = {
    "STRONG_GROWTH": "change greater than +5%",
    "MODERATE_GROWTH": "change between 0% and +5%",
    "MODERATE_DECLINE": "change between -5% and 0%",
    "SEVERE_DECLINE": "change less than -5%",
}
LABELS = list(THRESHOLDS.keys())

NUM_RE = re.compile(r"^[\d.,|]+$")
HEADER_HINTS = (
    "state/ut", "figures in", "category", "entity", "table", "no. of",
    "ministry", "2019-20", "union territory", "state (", "government of india",
    "economic", "statistics division", "petroleum and natural gas",
)


def parse_num(tok: str):
    """Parse an OCR'd numeric token. Returns float or None."""
    t = tok.replace(",", "").replace("|", "").strip()
    if not t or not NUM_RE.match(tok):
        return None
    digits = sum(c.isdigit() for c in t)
    if digits < 2:  # need at least 2 digits to be a real figure
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    if v <= 0 or v > 1e9:
        return None
    return v


def extract_rows(page_text: str):
    """Yield (name, [v1..v6], optional_change_pct) rows from one page."""
    rows = []
    for line in page_text.splitlines():
        line = line.strip()
        if len(line) < 8:
            continue
        low = line.lower()
        if any(h in low for h in HEADER_HINTS):
            continue
        tokens = re.split(r"\s+", line)
        # find the longest run of numeric-ish tokens
        best = None
        i = 0
        while i < len(tokens):
            j = i
            while j < len(tokens) and (NUM_RE.match(tokens[j]) or tokens[j] in ("|",)):
                j += 1
            run = tokens[i:j]
            vals = [v for v in (parse_num(t) for t in run) if v is not None]
            if best is None or len(vals) > len(best):
                best = vals
                name_end = i
            i = max(j, i + 1)
        if not best or len(best) < 6:
            continue
        name = " ".join(tokens[:name_end]).strip(" |")
        name = re.sub(r"\(.*?\)", "", name).strip(" .-|")
        name = re.sub(r"^\d+\.\s*", "", name)  # drop list numbering like "1."
        if len(name) < 2 or name.lower() in HEADER_HINTS:
            continue
        vals = best[:7]
        change_pct = vals[6] if len(vals) == 7 else None
        six = vals[:6]
        # self-validation against the report's own printed change %
        if change_pct is not None and six[4] > 0:
            computed = (six[5] - six[4]) / six[4] * 100
            if abs(computed - change_pct) > 1.5:
                continue
        rows.append((name, six, change_pct))
    return rows


def classify(change_pct: float) -> str:
    if change_pct > 5:
        return "STRONG_GROWTH"
    if change_pct >= 0:
        return "MODERATE_GROWTH"
    if change_pct >= -5:
        return "MODERATE_DECLINE"
    return "SEVERE_DECLINE"


def table_meta(page_text: str, page_no: int):
    head = "\n".join(page_text.splitlines()[:6])
    m = re.search(r"([IVXLC]+\.\d+|Table\s+\d+)", head)
    tid = m.group(1) if m else f"page-{page_no}"
    m2 = re.search(r"Figures in ([A-Za-z][A-Za-z &/()-]{2,30})", head)
    unit = m2.group(1).strip() if m2 else "the reported unit"
    m3 = re.search(r"[:\-]?\s*([A-Z][A-Za-z0-9 &/()'-]{8,80})", head)
    title = (m3.group(1).strip() if m3 else f"Table on page {page_no}")
    return tid, title, unit


def main():
    random.seed(42)
    pages = sorted(OCR_DIR.glob("page_*.txt"))
    print(f"OCR pages found: {len(pages)}")

    tables = []  # (tid, title, unit, table_text, rows)
    for p in pages:
        page_no = int(re.search(r"(\d+)", p.stem).group(1))
        text = p.read_text(errors="ignore")
        rows = extract_rows(text)
        if len(rows) < 3:  # not a usable table page
            continue
        # only keep tables with the 6-year column structure (2019-20 .. 2024-25)
        head = text[:400]
        if "2019-20" not in head.replace("201920", "2019-20") and "2020-21" not in head:
            continue
        if "2024-25" not in head.replace("202425", "2024-25") and "2023-24" not in head:
            continue
        tid, title, unit = table_meta(text, page_no)
        if "Ministry of Petroleum" in title:
            # use the line directly above the first row as the title
            lines = [l for l in text.splitlines() if l.strip()]
            for li, l in enumerate(lines):
                if rows[0][0][:10] in l:
                    title = lines[li - 1].strip() if li > 0 else f"Table on page {page_no}"
                    break
        # keep only the table region: from first row line to last row line
        first_idx = text.find(rows[0][0][:15])
        table_text = text[first_idx:].strip() if first_idx >= 0 else text.strip()
        tables.append((tid, title, unit, table_text, rows))

    print(f"Usable tables: {len(tables)}")

    # build samples: one per (row, year-pair)
    samples_by_table = {}
    for tid, title, unit, table_text, rows in tables:
        samples = []
        for name, six, change_pct in rows:
            for i in range(5):
                a, b = six[i], six[i + 1]
                if a <= 0 or b <= 0:
                    continue
                # skip implausible jumps (>20x or >95% drop) unless the row
                # passed the report's own printed change-% validation
                if change_pct is None and (b / a > 20 or b / a < 0.05):
                    continue
                change = (b - a) / a * 100
                label = classify(change)
                fy_prev = f"20{i+19}-{str(i+20)[-2:]}"
                fy_curr = f"20{i+20}-{str(i+21)[-2:]}"
                prompt = (
                    "You are a domain expert analyst for the Indian petroleum & natural gas sector.\n\n"
                    f"Below is an excerpt from the official \"Indian Petroleum & Natural Gas Statistics 2024-25\" "
                    f"(Government of India, Ministry of Petroleum and Natural Gas, Economic & Statistics Division). "
                    f"Table {tid}: {title} (figures in {unit}).\n\n"
                    f"{table_text}\n\n"
                    f"Task: Classify the year-over-year trend of \"{name}\" between FY{fy_prev} and FY{fy_curr} "
                    f"using the sector health thresholds:\n"
                    f"- STRONG_GROWTH: {THRESHOLDS['STRONG_GROWTH']}\n"
                    f"- MODERATE_GROWTH: {THRESHOLDS['MODERATE_GROWTH']}\n"
                    f"- MODERATE_DECLINE: {THRESHOLDS['MODERATE_DECLINE']}\n"
                    f"- SEVERE_DECLINE: {THRESHOLDS['SEVERE_DECLINE']}\n\n"
                    "Respond with exactly one label: STRONG_GROWTH, MODERATE_GROWTH, MODERATE_DECLINE or SEVERE_DECLINE."
                )
                samples.append({
                    "messages": [
                        {"role": "user", "content": prompt},
                        {"role": "assistant", "content": label},
                    ],
                    "_meta": {"table": tid, "entity": name, "pair": f"{fy_prev}->{fy_curr}",
                              "change_pct": round(change, 2)},
                })
        if samples:
            samples_by_table[tid] = (title, samples)

    all_samples = [s for _, (_, s) in samples_by_table.items()]
    print(f"Total samples: {len(all_samples)}")

    # table-level 80/20 split
    tids = list(samples_by_table.keys())
    random.shuffle(tids)
    n_train = max(1, int(len(tids) * 0.8))
    train_tids, test_tids = set(tids[:n_train]), set(tids[n_train:])

    train = [s for t in train_tids for s in samples_by_table[t][1]]
    test = [s for t in test_tids for s in samples_by_table[t][1]]

    # strip _meta, write
    for name, data in (("train", train), ("test", test)):
        clean = [{"messages": s["messages"]} for s in data]
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / f"{name}.json").write_text(json.dumps(clean, indent=1))

    # stats report
    from collections import Counter
    stats = {
        "source": "Indian Petroleum & Natural Gas Statistics 2024-25 (MoPNG, Govt of India)",
        "ocr_pages": len(pages),
        "usable_tables": len(tables),
        "train_tables": len(train_tids),
        "test_tables": len(test_tids),
        "train_samples": len(train),
        "test_samples": len(test),
        "train_class_dist": dict(Counter(s["messages"][1]["content"] for s in train)),
        "test_class_dist": dict(Counter(s["messages"][1]["content"] for s in test)),
        "test_tables": sorted(test_tids),
    }
    (OUT_DIR / "stats.json").write_text(json.dumps(stats, indent=2))
    print(json.dumps({k: v for k, v in stats.items() if k != "test_tables"}, indent=2))
    # examples
    for s in test[:2]:
        print("\n--- EXAMPLE (test) ---")
        print(s["messages"][0]["content"][:600], "\n=>", s["messages"][1]["content"])


if __name__ == "__main__":
    main()
