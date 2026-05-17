"""
Stratified sampler for WildChat-1M.

Pulls a target-N sample stratified by model, task type, and user-turn length.
Each row is one (user_message, assistant_message) pair. Up to 3 turns per
conversation contribute.

Output: benchmark/wildchat/data/wildchat_sample.jsonl

Schema:
  {id, conversation_id, turn_idx, model, task_type, length_bucket,
   user_message, assistant_message, lang}

Run:
    python3 benchmark/wildchat/fetch_wildchat.py --target-n 1000
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Task-type classification via simple regex on user turn 0.
TASK_PATTERNS = [
    ("summarize",   re.compile(r"\b(summari[sz]e|tl;dr|in (a )?few (words|sentences)|brief)\b", re.I)),
    ("rewrite",     re.compile(r"\b(rewrite|rephrase|paraphras|polish|improve.*(grammar|writing|email)|make.*(better|formal|casual|professional))\b", re.I)),
    ("code",        re.compile(r"\b(write|fix|debug|refactor|implement)\b.*\b(code|function|script|class|method|python|javascript|typescript|java|c\+\+|sql|html|css)\b", re.I)),
    ("translate",   re.compile(r"\b(translate|in (spanish|french|german|chinese|japanese|korean|hindi)|to (spanish|french|german|chinese|japanese|korean|hindi))\b", re.I)),
    ("qa",          re.compile(r"^\s*(what|who|when|where|why|how|is|are|can|do|does|did)\b", re.I)),
]

def classify_task(text: str) -> str:
    if not text:
        return "other"
    for label, pat in TASK_PATTERNS:
        if pat.search(text):
            return label
    return "other"


def length_bucket(text: str) -> str:
    n = len(text)
    if n < 100:
        return "short"
    if n < 500:
        return "medium"
    return "long"


def normalize_model(name: str | None) -> str:
    if not name:
        return "unknown"
    n = name.lower()
    if "gpt-4-turbo" in n or "gpt-4t" in n:
        return "gpt-4-turbo"
    if "gpt-4o" in n:
        return "gpt-4o"
    if "gpt-4" in n:
        return "gpt-4"
    if "gpt-3.5" in n or "gpt-35" in n:
        return "gpt-3.5-turbo"
    return n.split("-")[0]


def detect_lang(text: str) -> str:
    try:
        from langdetect import detect, DetectorFactory
        DetectorFactory.seed = 0
        return detect(text[:500])
    except Exception:
        return "unknown"


def iter_pairs(conv, max_turns: int = 3):
    """Yield up to max_turns (user, assistant) pairs from a conversation."""
    turns = conv.get("conversation") or []
    user_turn = None
    pairs = []
    for t in turns:
        role = t.get("role")
        content = t.get("content") or ""
        if role == "user":
            user_turn = content
        elif role == "assistant" and user_turn:
            pairs.append((user_turn, content))
            user_turn = None
            if len(pairs) >= max_turns:
                break
    return pairs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-n", type=int, default=1000)
    parser.add_argument("--max-conversations", type=int, default=100_000,
                        help="cap on conversations to scan from the stream")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(OUT_DIR / "wildchat_sample.jsonl"))
    args = parser.parse_args()

    from datasets import load_dataset
    print(f"[wildchat] streaming allenai/WildChat-1M (target N={args.target_n})", flush=True)
    rng = random.Random(args.seed)

    ds = load_dataset("allenai/WildChat-1M", split="train", streaming=True)

    rows: list[dict] = []
    seen_conv = 0
    per_stratum = defaultdict(int)
    # Cap per stratum so no single bucket dominates. ~target / 30 (5 models × 6 tasks)
    stratum_cap = max(5, args.target_n // 20)

    for conv in ds:
        if seen_conv >= args.max_conversations:
            break
        seen_conv += 1
        if seen_conv % 1000 == 0:
            print(f"  scanned {seen_conv} conversations, collected {len(rows)}", flush=True)
        if len(rows) >= args.target_n:
            break

        model = normalize_model(conv.get("model"))
        pairs = iter_pairs(conv)
        if not pairs:
            continue

        # Task type from first user turn
        task = classify_task(pairs[0][0])

        for turn_idx, (user_msg, asst_msg) in enumerate(pairs):
            if len(rows) >= args.target_n:
                break
            if not user_msg or len(user_msg.strip()) < 10:
                continue
            if not asst_msg or len(asst_msg.strip()) < 10:
                continue
            lb = length_bucket(user_msg)
            stratum_key = (model, task, lb)
            if per_stratum[stratum_key] >= stratum_cap:
                continue
            lang = detect_lang(user_msg)
            if lang != "en":
                continue
            rows.append({
                "id": f"wc_{conv.get('conversation_hash', seen_conv)}_{turn_idx}",
                "conversation_id": str(conv.get("conversation_hash", seen_conv)),
                "turn_idx": turn_idx,
                "model": model,
                "task_type": task,
                "length_bucket": lb,
                "user_message": user_msg,
                "assistant_message": asst_msg,
                "lang": lang,
            })
            per_stratum[stratum_key] += 1

    rng.shuffle(rows)
    rows = rows[: args.target_n]

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(f"\n[wildchat] wrote {len(rows)} rows → {out_path}", flush=True)
    print(f"[wildchat] scanned {seen_conv} conversations", flush=True)
    print()
    print("Stratification stats:")
    print(f"  by model:")
    for k, v in Counter(r["model"] for r in rows).most_common():
        print(f"    {k:20s} {v}")
    print(f"  by task_type:")
    for k, v in Counter(r["task_type"] for r in rows).most_common():
        print(f"    {k:20s} {v}")
    print(f"  by length_bucket:")
    for k, v in Counter(r["length_bucket"] for r in rows).most_common():
        print(f"    {k:20s} {v}")


if __name__ == "__main__":
    main()
