"""
Merge, dedup, and balance the 4 extracted JSONL files into one Pillar A bench.

Steps:
  1. Read all *.jsonl from benchmark/data/pillar_a/extract/
  2. Dedup by (original_lower, suggested_lower)
  3. Balance: cap each category at MAX_PER_CATEGORY
  4. Add clean-paraphrase negatives from WANLI(entailment) + PAWS(label=1)
  5. Optionally merge with seed.jsonl

Run:
    python3 benchmark/hf_extract/merge_balance.py
    python3 benchmark/hf_extract/merge_balance.py --merge-into-seed
    python3 benchmark/hf_extract/merge_balance.py --max-per-category 300
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXTRACT_DIR = ROOT / "benchmark" / "data" / "pillar_a" / "extract"
OUT_PATH = ROOT / "benchmark" / "data" / "pillar_a" / "pillar_a.jsonl"
SEED_PATH = ROOT / "benchmark" / "data" / "seed.jsonl"
SEED_OUT_PATH = ROOT / "benchmark" / "data" / "seed_v2.jsonl"


def load_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


def write_jsonl(p: Path, rows: list[dict]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-per-category", type=int, default=200,
                        help="cap each category at N (default 200)")
    parser.add_argument("--max-negatives", type=int, default=200,
                        help="add up to N true_paraphrase negatives (default 200)")
    parser.add_argument("--merge-into-seed", action="store_true",
                        help="write seed_v2.jsonl = seed.jsonl + new pillar_a")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)

    # ---- 1. Load all extracted files ----
    all_rows: list[dict] = []
    for p in sorted(EXTRACT_DIR.glob("*.jsonl")):
        rows = load_jsonl(p)
        print(f"  loaded {len(rows):>6d} from {p.name}")
        all_rows.extend(rows)
    print(f"  total raw: {len(all_rows)}")

    # ---- 2. Dedup ----
    seen: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for r in all_rows:
        key = (r["original"].strip().lower(), r["suggested"].strip().lower())
        if key in seen:
            continue
        if key[0] == key[1]:
            continue  # skip identity pairs
        seen.add(key)
        deduped.append(r)
    print(f"  after dedup: {len(deduped)} (dropped {len(all_rows) - len(deduped)})")

    # ---- 3. Balance per-category ----
    by_cat: dict[str, list[dict]] = {}
    for r in deduped:
        by_cat.setdefault(r["category"], []).append(r)

    balanced: list[dict] = []
    print(f"  category breakdown (capped at {args.max_per_category}):")
    for cat in sorted(by_cat):
        rows = by_cat[cat]
        rng.shuffle(rows)
        keep = rows[: args.max_per_category]
        balanced.extend(keep)
        print(f"    {cat:25s} {len(rows):>5d} → {len(keep)}")

    # ---- 4. Add negatives from WANLI(entailment) and PAWS(label=1) ----
    # We didn't extract these in the first pass. For now, emit a placeholder
    # message — negatives can be added in a second pass if needed.
    # (The seed.jsonl already has true_paraphrase negatives; merge handles that.)

    # ---- 5. Write output ----
    rng.shuffle(balanced)
    write_jsonl(OUT_PATH, balanced)
    print(f"  wrote {len(balanced)} examples → {OUT_PATH}")

    if args.merge_into_seed:
        seed = load_jsonl(SEED_PATH)
        merged = seed + balanced
        write_jsonl(SEED_OUT_PATH, merged)
        print(f"  merged {len(seed)} seed + {len(balanced)} pillar_a "
              f"= {len(merged)} → {SEED_OUT_PATH}")


if __name__ == "__main__":
    main()
