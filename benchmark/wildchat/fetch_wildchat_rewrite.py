"""
WildChat fetcher v2 — rewrite-style turns only.

The pilot run on (prompt, response) pairs revealed a methodology mismatch:
SIL evaluates paraphrase-class rewrites, but prompt/response pairs have no
entailment relationship to evaluate, causing NLI to overfire to ~97%
"corruption" rate.

This fetcher filters WildChat to only turns where the user is asking the
assistant to rewrite some user-provided text. It extracts:
  - `original` = the user-pasted source text (NOT the full prompt)
  - `suggested` = the assistant's rewritten response

This puts SIL back on its design surface.

Detection strategy:
  1. Regex-match the user prompt against rewrite-trigger phrases
     ("rewrite this", "polish", "improve", "make this more X", etc.)
  2. Extract the user-pasted source text using delimiter patterns
     (colon + body, quoted block, triple-backtick block, newline + body)
  3. Skip turns where the source text can't be cleanly isolated

Output schema (same as fetch_wildchat.py with two extra fields):
  {id, conversation_id, turn_idx, model, rewrite_type, length_bucket,
   user_message,           # full original prompt (kept for audit)
   original,               # extracted user-pasted source text
   assistant_message,      # SIL's `suggested`
   trigger_phrase,         # which regex matched
   lang}

Run:
    python3 benchmark/wildchat/fetch_wildchat_rewrite.py --target-n 1000
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


# ----------------------------------------------------------------------------
# Rewrite-trigger detection
# ----------------------------------------------------------------------------

# Each pattern maps to a rewrite_type label for stratification.
REWRITE_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("rephrase",   re.compile(r"\b(rewrite|rephrase|paraphrase|reword)\b.*?(this|the following|my|it|these|below|above)", re.I)),
    ("polish",     re.compile(r"\b(polish|improve|enhance|refine|clean up|tighten)\b.*?(this|the following|my|it|these|below|above)", re.I)),
    ("fix",        re.compile(r"\b(fix|correct|edit)\b.*?(grammar|spelling|this|the following|my|it|below|above)", re.I)),
    ("tone",       re.compile(r"\b(make|rewrite|rephrase)\b.*?(more|less)\s+(formal|casual|professional|friendly|polite|concise|clear|natural|gentle|assertive|direct)", re.I)),
    ("shorten",    re.compile(r"\b(shorten|condense|trim|compress|tighten)\b.*?(this|the following|my|it|below|above)", re.I)),
    ("expand",     re.compile(r"\b(expand|elaborate|lengthen|extend|develop)\b.*?(this|the following|my|it|below|above)", re.I)),
    ("summarize",  re.compile(r"\b(summari[sz]e|tldr|tl;dr)\b.*?(this|the following|my|it|below|above|article|text|paragraph|email|message)", re.I)),
    ("translate",  re.compile(r"\btranslate\b.*?\b(to|into)\s+(spanish|french|german|chinese|japanese|korean|hindi|english|italian|portuguese|russian|arabic)\b", re.I)),
    ("proofread",  re.compile(r"\bproof[- ]?read\b", re.I)),
    ("formal",     re.compile(r"\b(formali[sz]e|professionali[sz]e)\b.*?(this|the following|my|it|below|above)", re.I)),
]


# Delimiters that tend to introduce user-pasted source text after a rewrite request.
# Order matters: try most-explicit first.
DELIMITER_PATTERNS: list[re.Pattern] = [
    # Triple-backtick fenced block
    re.compile(r"```(?:\w+)?\s*\n?(.+?)\n?```", re.S),
    # Triple-quote block
    re.compile(r'"""(.+?)"""', re.S),
    # Quoted block (double quote, capturing inside) — must be >40 chars
    re.compile(r'"([^"]{40,})"', re.S),
    # Quoted block (single quote, paragraph-length)
    re.compile(r"'([^']{60,})'", re.S),
    # "Text:" followed by content
    re.compile(r"(?:text|email|message|paragraph|sentence|content|the following|here is|here's)[:\s]*\n+(.+)$", re.I | re.S),
    # Colon at end of first line, content on subsequent lines
    re.compile(r"^[^\n]{5,200}:\s*\n+(.+)$", re.S),
]


def detect_rewrite(prompt: str) -> tuple[str, str] | None:
    """Return (rewrite_type, trigger_phrase) if the prompt is a rewrite request."""
    if not prompt:
        return None
    for label, pat in REWRITE_PATTERNS:
        m = pat.search(prompt)
        if m:
            return label, m.group(0)
    return None


def extract_source_text(prompt: str) -> str | None:
    """Try each delimiter pattern to isolate the user-pasted source text."""
    for pat in DELIMITER_PATTERNS:
        m = pat.search(prompt)
        if m:
            candidate = m.group(1).strip()
            # Sanity: must be substantial and not just be another instruction
            if len(candidate) >= 20 and not _looks_like_instruction(candidate):
                return candidate
    return None


_INSTR_RE = re.compile(
    r"\b(rewrite|polish|improve|fix|edit|make|shorten|expand|translate|summari[sz]e|please|can you|could you)\b",
    re.I,
)


def _looks_like_instruction(text: str) -> bool:
    """True if the extracted candidate looks like another rewrite instruction."""
    # If it's short and mostly imperative verbs, skip
    if len(text) < 100 and _INSTR_RE.search(text):
        return True
    return False


# ----------------------------------------------------------------------------
# Helpers (shared with fetch_wildchat.py — kept inline for self-containment)
# ----------------------------------------------------------------------------

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


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-n", type=int, default=1000)
    parser.add_argument("--max-conversations", type=int, default=200_000,
                        help="cap on conversations to scan from the stream")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(OUT_DIR / "wildchat_rewrite_sample.jsonl"))
    args = parser.parse_args()

    from datasets import load_dataset
    print(f"[rewrite] streaming allenai/WildChat-1M (target N={args.target_n})", flush=True)
    rng = random.Random(args.seed)

    ds = load_dataset("allenai/WildChat-1M", split="train", streaming=True)

    rows: list[dict] = []
    seen_conv = 0
    n_rewrite_match = 0
    n_source_extracted = 0
    per_stratum = defaultdict(int)
    stratum_cap = max(20, args.target_n // 10)

    for conv in ds:
        if seen_conv >= args.max_conversations:
            break
        seen_conv += 1
        if seen_conv % 5000 == 0:
            print(f"  scanned {seen_conv} convs, matched {n_rewrite_match} rewrites, "
                  f"extracted {n_source_extracted} sources, kept {len(rows)}",
                  flush=True)
        if len(rows) >= args.target_n:
            break

        model = normalize_model(conv.get("model"))
        pairs = iter_pairs(conv)
        if not pairs:
            continue

        for turn_idx, (user_msg, asst_msg) in enumerate(pairs):
            if len(rows) >= args.target_n:
                break
            if not user_msg or len(user_msg.strip()) < 30:
                continue
            if not asst_msg or len(asst_msg.strip()) < 20:
                continue
            rw = detect_rewrite(user_msg)
            if rw is None:
                continue
            rewrite_type, trigger = rw
            n_rewrite_match += 1
            source = extract_source_text(user_msg)
            if source is None:
                continue
            n_source_extracted += 1

            stratum_key = (model, rewrite_type)
            if per_stratum[stratum_key] >= stratum_cap:
                continue

            lang = detect_lang(source)
            if lang != "en":
                continue
            rows.append({
                "id": f"wcr_{conv.get('conversation_hash', seen_conv)}_{turn_idx}",
                "conversation_id": str(conv.get("conversation_hash", seen_conv)),
                "turn_idx": turn_idx,
                "model": model,
                "rewrite_type": rewrite_type,
                "length_bucket": length_bucket(source),
                "trigger_phrase": trigger[:120],
                "user_message": user_msg[:2000],   # full prompt, capped for audit
                # NOTE: the downstream scoring script reads `user_message` as
                # `original` and `assistant_message` as `suggested`. For this
                # rewrite-only flow we expose the EXTRACTED source text via
                # `user_message` so the existing scorer works unchanged.
                "_full_prompt": user_msg[:2000],   # preserved for audit
                "assistant_message": asst_msg,
                "lang": lang,
                # Also fill task_type/length_bucket so analyze script keeps working
                "task_type": rewrite_type,
            })
            # Overwrite user_message with the extracted source so the scorer
            # uses the right field as `original`. Keep full prompt under _full_prompt.
            rows[-1]["user_message"] = source
            per_stratum[stratum_key] += 1

    rng.shuffle(rows)
    rows = rows[: args.target_n]

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(f"\n[rewrite] wrote {len(rows)} rows → {out_path}", flush=True)
    print(f"[rewrite] scanned {seen_conv} conversations", flush=True)
    print(f"[rewrite] matched {n_rewrite_match} rewrite prompts ({n_rewrite_match/max(1,seen_conv)*100:.1f}%)", flush=True)
    print(f"[rewrite] extracted source from {n_source_extracted} ({n_source_extracted/max(1,n_rewrite_match)*100:.1f}% of matches)", flush=True)
    print()
    print("Stratification:")
    print(f"  by model:")
    for k, v in Counter(r["model"] for r in rows).most_common():
        print(f"    {k:20s} {v}")
    print(f"  by rewrite_type:")
    for k, v in Counter(r["rewrite_type"] for r in rows).most_common():
        print(f"    {k:20s} {v}")
    print(f"  by length_bucket:")
    for k, v in Counter(r["length_bucket"] for r in rows).most_common():
        print(f"    {k:20s} {v}")


if __name__ == "__main__":
    main()
