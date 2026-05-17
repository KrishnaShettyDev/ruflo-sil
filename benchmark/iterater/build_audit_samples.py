"""Build the 30-FN, 30-FP audit sample for manual review.

FN: gold_intent == "meaning-changed" and SIL action == "pass" (SIL missed it).
FP: gold_intent in {"fluency", "coherence"} and SIL action != "pass" (SIL over-flagged).

Inputs:
  benchmark/iterater/data/iterater_sample.jsonl   (raw pairs with original/suggested)
  benchmark/iterater/data/iterater_scored.jsonl   (SIL scores keyed by id)

Output:
  benchmark/iterater/data/audit_samples.jsonl     (60 rows with empty audit fields)
"""

from __future__ import annotations

import json
import random
from pathlib import Path

SEED = 42
N_PER_BUCKET = 30
ROOT = Path(__file__).resolve().parent / "data"
SAMPLE_PATH = ROOT / "iterater_sample.jsonl"
SCORED_PATH = ROOT / "iterater_scored.jsonl"
OUT_PATH = ROOT / "audit_samples.jsonl"


def load_jsonl(path: Path) -> list[dict]:
    with path.open() as f:
        return [json.loads(line) for line in f if line.strip()]


def main() -> None:
    samples = {r["id"]: r for r in load_jsonl(SAMPLE_PATH)}
    scored = load_jsonl(SCORED_PATH)

    fn_pool: list[dict] = []
    fp_pool: list[dict] = []
    for row in scored:
        gold = row.get("gold_intent")
        action = row.get("action")
        if gold == "meaning-changed" and action == "pass":
            fn_pool.append(row)
        elif gold in {"fluency", "coherence"} and action != "pass":
            fp_pool.append(row)

    rng = random.Random(SEED)
    fn_pool.sort(key=lambda r: r["id"])
    fp_pool.sort(key=lambda r: r["id"])
    fn_picks = rng.sample(fn_pool, min(N_PER_BUCKET, len(fn_pool)))
    fp_picks = rng.sample(fp_pool, min(N_PER_BUCKET, len(fp_pool)))

    rows_out = []
    for bucket, picks in (("FN", fn_picks), ("FP", fp_picks)):
        for r in picks:
            base = samples.get(r["id"], {})
            rows_out.append(
                {
                    "id": r["id"],
                    "bucket": bucket,
                    "original": base.get("original", ""),
                    "suggested": base.get("suggested", ""),
                    "iterater_intent": r.get("gold_intent"),
                    "sil_action": r.get("action"),
                    "sil_risk": r.get("overall_risk"),
                    "top_category": r.get("top_category"),
                    "audit_label": "",
                    "audit_notes": "",
                }
            )

    with OUT_PATH.open("w") as f:
        for r in rows_out:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(
        f"wrote {len(rows_out)} rows to {OUT_PATH.relative_to(Path.cwd())} "
        f"({len(fn_picks)} FN, {len(fp_picks)} FP, seed={SEED})"
    )


if __name__ == "__main__":
    main()
