"""
Extract Pillar A corruption pairs from 4 HuggingFace datasets in one pass.

Recipes from the ICOR-Bench research report:
  D1: WANLI                          → polarity_negation, scope_error, quantifier_shift
  D3: PAWS-Wiki                      → subject_object_swap
  D4: ParaDetox                      → tone_shift (inverted: neutral→toxic)
  D5: Anthropic model-written-evals  → commitment_distortion, intent_drift

Output schema (matches benchmark/data/seed.jsonl):
  {"id", "pillar", "category", "surface", "original", "suggested",
   "label", "severity", "notes", "source", "license"}

Run:
    python3 benchmark/hf_extract/run_extractions.py
"""
from __future__ import annotations

import difflib
import json
import sys
import time
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "pillar_a" / "extract"
OUT_DIR.mkdir(parents=True, exist_ok=True)

NEG_TOKENS = {"not", "no", "never", "n't", "cannot", "cant", "none", "neither", "nor"}


def _is_negation_flip(p: str, h: str) -> bool:
    pt = set(p.lower().split())
    ht = set(h.lower().split())
    return any((t in ht) != (t in pt) for t in NEG_TOKENS)


def _word_overlap(a: str, b: str) -> float:
    aw = a.lower().split()
    bw = b.lower().split()
    if not aw or not bw:
        return 0.0
    return difflib.SequenceMatcher(None, aw, bw).ratio()


# ---------------------------------------------------------------------------
# D1: WANLI
# ---------------------------------------------------------------------------

def extract_wanli() -> int:
    from datasets import load_dataset
    print("[D1] loading alisawuffles/WANLI", flush=True)
    ds = load_dataset("alisawuffles/WANLI", split="train")
    out_path = OUT_DIR / "wanli.jsonl"
    n_written = 0
    n_skipped_paraphrase = 0
    n_skipped_low_overlap = 0
    with out_path.open("w") as f:
        for i, ex in enumerate(ds):
            gold = ex.get("gold") or ex.get("label")
            if gold != "contradiction":
                n_skipped_paraphrase += 1
                continue
            p = ex.get("premise") or ""
            h = ex.get("hypothesis") or ""
            ratio = _word_overlap(p, h)
            if ratio < 0.4:
                n_skipped_low_overlap += 1
                continue
            cat = "polarity_negation" if _is_negation_flip(p, h) else "scope_error"
            rec = {
                "id": f"wanli_{ex.get('id', i)}",
                "pillar": "A",
                "category": cat,
                "surface": "document",
                "original": p,
                "suggested": h,
                "label": "corruption",
                "severity": 5 if cat == "polarity_negation" else 4,
                "notes": f"WANLI contradiction overlap={ratio:.2f}",
                "source": "WANLI",
                "license": "CC-BY-4.0",
            }
            f.write(json.dumps(rec) + "\n")
            n_written += 1
    print(f"[D1] WANLI wrote {n_written} pairs "
          f"(skipped {n_skipped_paraphrase} non-contradiction, "
          f"{n_skipped_low_overlap} low-overlap) → {out_path}", flush=True)
    return n_written


# ---------------------------------------------------------------------------
# D3: PAWS-Wiki (labeled_final)
# ---------------------------------------------------------------------------

def extract_paws() -> int:
    from datasets import load_dataset
    print("[D3] loading google-research-datasets/paws (labeled_final)", flush=True)
    ds = load_dataset("google-research-datasets/paws", "labeled_final", split="train")
    out_path = OUT_DIR / "paws.jsonl"
    n_written = 0
    with out_path.open("w") as f:
        for ex in ds:
            # label==0 means NOT a paraphrase → the pair is a subject/object swap
            if ex.get("label") != 0:
                continue
            s1 = ex.get("sentence1") or ""
            s2 = ex.get("sentence2") or ""
            if not (s1 and s2):
                continue
            rec = {
                "id": f"paws_{ex.get('id')}",
                "pillar": "A",
                "category": "subject_object_swap",
                "surface": "document",
                "original": s1,
                "suggested": s2,
                "label": "corruption",
                "severity": 4,
                "notes": "PAWS-Wiki high-overlap non-paraphrase",
                "source": "PAWS-Wiki",
                "license": "Free-for-any-purpose (Google)",
            }
            f.write(json.dumps(rec) + "\n")
            n_written += 1
    print(f"[D3] PAWS wrote {n_written} pairs → {out_path}", flush=True)
    return n_written


# ---------------------------------------------------------------------------
# D4: ParaDetox
# ---------------------------------------------------------------------------

def extract_paradetox() -> int:
    from datasets import load_dataset
    print("[D4] loading s-nlp/paradetox", flush=True)
    ds = load_dataset("s-nlp/paradetox", split="train")
    out_path = OUT_DIR / "paradetox.jsonl"
    n_written = 0
    # ParaDetox columns: en_toxic_comment, en_neutral_comment1/2/3
    for col in ds.column_names:
        print(f"[D4] column: {col}", flush=True)
    with out_path.open("w") as f:
        for i, ex in enumerate(ds):
            toxic = ex.get("en_toxic_comment") or ex.get("toxic") or ""
            # neutral may be a single field or multiple references
            neutral = (
                ex.get("en_neutral_comment1")
                or ex.get("en_neutral_comment")
                or ex.get("neutral_comment")
                or ex.get("neutral")
                or ""
            )
            if not (toxic and neutral):
                continue
            # Invert direction: corruption = neutral → toxic
            rec = {
                "id": f"paradetox_{i}",
                "pillar": "A",
                "category": "tone_shift",
                "surface": "chat",
                "original": neutral,
                "suggested": toxic,
                "label": "corruption",
                "severity": 4,
                "notes": "ParaDetox neutral→toxic (inverted direction)",
                "source": "ParaDetox",
                "license": "CC-BY-4.0",
            }
            f.write(json.dumps(rec) + "\n")
            n_written += 1
    print(f"[D4] ParaDetox wrote {n_written} pairs → {out_path}", flush=True)
    return n_written


# ---------------------------------------------------------------------------
# D5: Anthropic model-written-evals (sycophancy)
# ---------------------------------------------------------------------------

def extract_anthropic_sycophancy() -> int:
    from datasets import load_dataset
    print("[D5] loading Anthropic/model-written-evals (sycophancy)", flush=True)
    files = [
        "sycophancy/sycophancy_on_nlp_survey.jsonl",
        "sycophancy/sycophancy_on_philpapers2020.jsonl",
        "sycophancy/sycophancy_on_political_typology_quiz.jsonl",
    ]
    ds = load_dataset(
        "Anthropic/model-written-evals",
        data_files=files,
        split="train",
    )
    out_path = OUT_DIR / "anthropic_sycophancy.jsonl"
    n_written = 0
    with out_path.open("w") as f:
        for i, ex in enumerate(ds):
            q = ex.get("question") or ""
            matching = ex.get("answer_matching_behavior") or ""
            not_matching = ex.get("answer_not_matching_behavior") or ""
            if not (q and matching and not_matching):
                continue
            # The non-sycophantic answer is the "original" (faithful to truth),
            # the sycophantic answer is the "suggested" (corrupted toward user).
            rec = {
                "id": f"syc_{i}",
                "pillar": "A",
                "category": "commitment_distortion",
                "surface": "chat",
                "original": (q + " " + not_matching).strip(),
                "suggested": (q + " " + matching).strip(),
                "label": "corruption",
                "severity": 4,
                "notes": "Anthropic sycophancy: faithful → user-matching",
                "source": "Anthropic/model-written-evals",
                "license": "CC-BY-4.0",
            }
            f.write(json.dumps(rec) + "\n")
            n_written += 1
    print(f"[D5] Anthropic sycophancy wrote {n_written} pairs → {out_path}", flush=True)
    return n_written


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def main() -> None:
    t0 = time.time()
    results = {}
    for name, fn in [
        ("D1_wanli", extract_wanli),
        ("D3_paws", extract_paws),
        ("D4_paradetox", extract_paradetox),
        ("D5_anthropic_sycophancy", extract_anthropic_sycophancy),
    ]:
        t = time.time()
        try:
            results[name] = fn()
            print(f"  ✓ {name} done in {time.time()-t:.1f}s", flush=True)
        except Exception as e:
            results[name] = f"ERROR: {type(e).__name__}: {e}"
            print(f"  ✗ {name} failed: {e}", file=sys.stderr, flush=True)

    print("\n========== EXTRACTION SUMMARY ==========", flush=True)
    for k, v in results.items():
        print(f"  {k:30s} {v}", flush=True)
    print(f"  total wall time: {time.time()-t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
