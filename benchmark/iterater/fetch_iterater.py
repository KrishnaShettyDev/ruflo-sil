"""
Fetch the IteraTeR human-labeled sentence pairs for SIL evaluation.

Source: wanyu/IteraTeR_human_sent (Du et al., "Understanding Iterative Revision
from Human-Written Text", ACL 2022). Each row has:
  - before_sent: the original sentence
  - after_sent: the revised sentence
  - labels: human-annotated revision intention
      ∈ {meaning-changed, fluency, coherence, clarity, style}

Label mapping for SIL evaluation:
  meaning-changed → corruption  (positive class)
  fluency, coherence → clean    (negative class)
  clarity, style → ambiguous    (reported separately; excluded from binary)

Output schema:
  {id, doc_id, revision_depth, original, suggested, gold_intent, gold_binary, lang}
  - gold_intent: raw IteraTeR label
  - gold_binary: "corruption" | "clean" | "ambiguous"

Run:
    python3 benchmark/iterater/fetch_iterater.py --target-n 500
"""
from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

INTENT_TO_BINARY = {
    "meaning-changed": "corruption",
    "fluency": "clean",
    "coherence": "clean",
    "clarity": "ambiguous",
    "style": "ambiguous",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-n", type=int, default=500)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(OUT_DIR / "iterater_sample.jsonl"))
    parser.add_argument("--stratify", action="store_true", default=True,
                        help="balance across intent labels (default on)")
    args = parser.parse_args()

    from datasets import load_dataset
    print("[iterater] loading wanyu/IteraTeR_human_sent (full split)", flush=True)
    ds = load_dataset("wanyu/IteraTeR_human_sent", split="train")
    rng = random.Random(args.seed)

    # Index by intent for stratification
    by_intent: dict[str, list[dict]] = {}
    for i, ex in enumerate(ds):
        lab = ex.get("labels", "").strip().lower()
        if lab not in INTENT_TO_BINARY:
            continue
        before = (ex.get("before_sent") or "").strip()
        after = (ex.get("after_sent") or "").strip()
        if not before or not after or before == after:
            continue
        if len(before) < 10 or len(after) < 10:
            continue
        by_intent.setdefault(lab, []).append({
            "raw_idx": i,
            "doc_id": ex.get("doc_id", ""),
            "revision_depth": ex.get("revision_depth", 0),
            "original": before,
            "suggested": after,
            "gold_intent": lab,
            "gold_binary": INTENT_TO_BINARY[lab],
        })

    print(f"[iterater] indexed {sum(len(v) for v in by_intent.values())} valid rows", flush=True)
    print("[iterater] available per intent:")
    for lab, lst in sorted(by_intent.items(), key=lambda x: -len(x[1])):
        print(f"    {lab:20s} {len(lst)}")

    rows: list[dict] = []
    if args.stratify:
        # Even allocation across 5 intent labels (capped by what's available)
        per_label = max(10, args.target_n // 5)
        for lab, lst in by_intent.items():
            rng.shuffle(lst)
            take = lst[:per_label]
            rows.extend(take)
    else:
        all_rows: list[dict] = []
        for lst in by_intent.values():
            all_rows.extend(lst)
        rng.shuffle(all_rows)
        rows = all_rows[: args.target_n]

    rng.shuffle(rows)
    rows = rows[: args.target_n]

    for i, r in enumerate(rows):
        r["id"] = f"iter_{r['doc_id']}_{r['revision_depth']}_{i}"
        r["lang"] = "en"

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(f"\n[iterater] wrote {len(rows)} rows → {out_path}", flush=True)
    print("\nStratification:")
    print("  by gold_intent:")
    for k, v in Counter(r["gold_intent"] for r in rows).most_common():
        print(f"    {k:20s} {v}")
    print("  by gold_binary:")
    for k, v in Counter(r["gold_binary"] for r in rows).most_common():
        print(f"    {k:20s} {v}")


if __name__ == "__main__":
    main()
