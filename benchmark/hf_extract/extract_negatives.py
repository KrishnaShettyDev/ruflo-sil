"""
Second-pass extraction: add clean (paraphrase) negatives so the bench can
measure precision and false-positive rate meaningfully.

Sources:
  - WANLI gold==entailment, high-overlap → true_paraphrase
  - PAWS-Wiki label==1 (paraphrase) → true_paraphrase

Output: benchmark/data/pillar_a/extract/negatives.jsonl
"""
from __future__ import annotations

import difflib
import json
import random
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "pillar_a" / "extract"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def _word_overlap(a: str, b: str) -> float:
    aw, bw = a.lower().split(), b.lower().split()
    if not aw or not bw:
        return 0.0
    return difflib.SequenceMatcher(None, aw, bw).ratio()


def extract_negatives(max_per_source: int = 200) -> int:
    from datasets import load_dataset
    rng = random.Random(42)
    out_path = OUT_DIR / "negatives.jsonl"
    n_written = 0

    with out_path.open("w") as f:
        # ---- WANLI entailments ----
        print("[NEG-WANLI] loading", flush=True)
        ds = load_dataset("alisawuffles/WANLI", split="train")
        cands = []
        for i, ex in enumerate(ds):
            if (ex.get("gold") or ex.get("label")) != "entailment":
                continue
            p, h = ex.get("premise") or "", ex.get("hypothesis") or ""
            if _word_overlap(p, h) < 0.5:
                continue
            cands.append((i, p, h))
        rng.shuffle(cands)
        for i, p, h in cands[:max_per_source]:
            f.write(json.dumps({
                "id": f"wanli_ent_{i}",
                "pillar": "A",
                "category": "true_paraphrase",
                "surface": "document",
                "original": p, "suggested": h,
                "label": "clean", "severity": 1,
                "notes": "WANLI entailment (high-overlap paraphrase)",
                "source": "WANLI", "license": "CC-BY-4.0",
            }) + "\n")
            n_written += 1
        print(f"[NEG-WANLI] wrote {min(len(cands), max_per_source)} (had {len(cands)} candidates)", flush=True)

        # ---- PAWS paraphrases ----
        print("[NEG-PAWS] loading", flush=True)
        ds = load_dataset("google-research-datasets/paws", "labeled_final", split="train")
        cands = [(ex["id"], ex["sentence1"], ex["sentence2"]) for ex in ds if ex.get("label") == 1]
        rng.shuffle(cands)
        for i, s1, s2 in cands[:max_per_source]:
            f.write(json.dumps({
                "id": f"paws_para_{i}",
                "pillar": "A",
                "category": "true_paraphrase",
                "surface": "document",
                "original": s1, "suggested": s2,
                "label": "clean", "severity": 1,
                "notes": "PAWS-Wiki paraphrase",
                "source": "PAWS-Wiki", "license": "Free-for-any-purpose (Google)",
            }) + "\n")
            n_written += 1
        print(f"[NEG-PAWS] wrote {min(len(cands), max_per_source)} (had {len(cands)} candidates)", flush=True)

    print(f"[NEG] total {n_written} → {out_path}", flush=True)
    return n_written


if __name__ == "__main__":
    extract_negatives(max_per_source=200)
