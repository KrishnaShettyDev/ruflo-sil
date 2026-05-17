"""
D5 fix — bypass HF datasets schema enforcement by parsing JSONL files directly.

The 3 sycophancy files have slightly different schemas:
  - sycophancy_on_nlp_survey.jsonl:           3 keys
  - sycophancy_on_philpapers2020.jsonl:       3 keys
  - sycophancy_on_political_typology_quiz.jsonl: 4 keys (adds user_affiliation)

Hugging Face `datasets` library refuses to merge them due to schema drift.
We just read the files line-by-line and emit consistent records.

Run:
    python3 benchmark/hf_extract/extract_d5_anthropic.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "pillar_a" / "extract"
OUT_DIR.mkdir(parents=True, exist_ok=True)

FILES = [
    ("sycophancy_on_nlp_survey", "nlp_survey", "intent_drift"),
    ("sycophancy_on_philpapers2020", "philpapers", "commitment_distortion"),
    ("sycophancy_on_political_typology_quiz", "political_quiz", "commitment_distortion"),
]
BASE = "https://huggingface.co/datasets/Anthropic/model-written-evals/resolve/main/sycophancy"


def _download(name: str, cache: Path) -> Path:
    dest = cache / f"{name}.jsonl"
    if dest.exists() and dest.stat().st_size > 1024:
        return dest
    url = f"{BASE}/{name}.jsonl"
    token = os.environ.get("HF_TOKEN") or os.environ.get("HF_API_KEY") or ""
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    print(f"[D5] downloading {url}", flush=True)
    with urllib.request.urlopen(req, timeout=60) as r:
        dest.write_bytes(r.read())
    return dest


def main() -> int:
    cache = OUT_DIR / "_anthropic_cache"
    cache.mkdir(exist_ok=True)
    out_path = OUT_DIR / "anthropic_sycophancy.jsonl"

    n_written = 0
    with out_path.open("w") as fout:
        for name, slug, category in FILES:
            local = _download(name, cache)
            n_file = 0
            for i, line in enumerate(local.read_text().splitlines()):
                if not line.strip():
                    continue
                try:
                    ex = json.loads(line)
                except json.JSONDecodeError:
                    continue
                q = (ex.get("question") or "").strip()
                matching = (ex.get("answer_matching_behavior") or "").strip()
                not_matching = (ex.get("answer_not_matching_behavior") or "").strip()
                if not (q and matching and not_matching):
                    continue
                # The non-sycophantic answer is the faithful original;
                # the sycophantic answer is the corruption toward user.
                rec = {
                    "id": f"syc_{slug}_{i}",
                    "pillar": "A",
                    "category": category,
                    "surface": "chat",
                    "original": f"{q} {not_matching}".strip(),
                    "suggested": f"{q} {matching}".strip(),
                    "label": "corruption",
                    "severity": 4,
                    "notes": f"Anthropic sycophancy ({slug}): faithful → user-matching",
                    "source": "Anthropic/model-written-evals",
                    "license": "CC-BY-4.0",
                }
                fout.write(json.dumps(rec) + "\n")
                n_file += 1
                n_written += 1
            print(f"[D5] {name}: {n_file} pairs", flush=True)

    print(f"[D5] total {n_written} → {out_path}", flush=True)
    return n_written


if __name__ == "__main__":
    main()
