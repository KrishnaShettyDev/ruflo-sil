"""
Score WildChat samples through SIL via the HTTP API.

Reads wildchat_sample.jsonl, posts each row to http://localhost:8787/v1/score
with original=user_message, suggested=assistant_message. Writes results
incrementally (append-on-success) so a crash never loses progress. Resumes
by reading ids already in the output file and skipping them.

Schema (one row per line):
  {id, conversation_id, turn_idx, model, task_type, length_bucket,
   overall_risk, action, top_category, top_prob, categoryScores, latency_ms}

Run:
    python3 benchmark/wildchat/score_wildchat.py \\
        --in benchmark/wildchat/data/wildchat_sample.jsonl \\
        --out benchmark/wildchat/data/wildchat_scored.jsonl \\
        --concurrency 4
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SIL_URL = "http://localhost:8787/v1/score"


def load_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    rows: list[dict] = []
    for line in p.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


async def score_one(session, sem, row: dict, timeout_s: int) -> dict | None:
    import aiohttp
    # Truncate to 3000 chars (~500-700 tokens) — matches SIL's design surface
    # (keyboard, autocomplete, email, chat). Long-tail outliers above this
    # length are diluting signal anyway and saturating the LLM judge.
    MAX_CHARS = 3000
    original = row["user_message"][:MAX_CHARS]
    suggested = row["assistant_message"][:MAX_CHARS]
    payload = {
        "original": original,
        "suggested": suggested,
        "surface": "chat",
        "parallelTrajectories": 3,
    }
    async with sem:
        t0 = time.time()
        try:
            async with session.post(
                SIL_URL,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=timeout_s),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    print(f"  [score] {row['id']}: HTTP {resp.status} {body[:200]}", file=sys.stderr, flush=True)
                    return None
                data = await resp.json()
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            print(f"  [score] {row['id']}: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
            return None
        latency_ms = int((time.time() - t0) * 1000)

    # Extract top category
    cats = data.get("categoryScores") or []
    top = None
    if cats:
        top = max(cats, key=lambda c: c.get("probability", 0) * c.get("severity", 1))
    return {
        "id": row["id"],
        "conversation_id": row["conversation_id"],
        "turn_idx": row["turn_idx"],
        "model": row["model"],
        "task_type": row["task_type"],
        "length_bucket": row["length_bucket"],
        "overall_risk": data.get("overallRisk", 0.0),
        "action": data.get("action", "pass"),
        "top_category": top.get("category") if top else None,
        "top_prob": top.get("probability") if top else None,
        "categoryScores": [
            {"category": c["category"], "probability": c["probability"], "severity": c["severity"]}
            for c in cats
        ],
        "latency_ms": latency_ms,
        "scored_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


async def main_async(args) -> None:
    import aiohttp
    in_path = Path(args.in_path)
    out_path = Path(args.out_path)
    rows = load_jsonl(in_path)
    if not rows:
        print(f"[score] no rows in {in_path}", file=sys.stderr)
        sys.exit(2)
    if args.limit:
        rows = rows[: args.limit]

    # Resume: skip ids already in out file
    done_ids = {r["id"] for r in load_jsonl(out_path)}
    todo = [r for r in rows if r["id"] not in done_ids]
    print(f"[score] {len(rows)} total, {len(done_ids)} already done, {len(todo)} todo", flush=True)
    if not todo:
        print("[score] nothing to do; exiting cleanly")
        return

    sem = asyncio.Semaphore(args.concurrency)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fout = out_path.open("a")
    t_start = time.time()
    failures = 0
    processed = 0

    async with aiohttp.ClientSession() as session:
        # Stream results as they complete using as_completed
        coros = [score_one(session, sem, row, args.timeout) for row in todo]
        for fut in asyncio.as_completed(coros):
            res = await fut
            processed += 1
            if res is None:
                failures += 1
            else:
                fout.write(json.dumps(res) + "\n")
                fout.flush()
            if processed % 25 == 0 or processed == len(todo):
                elapsed = time.time() - t_start
                rate = processed / elapsed if elapsed > 0 else 0
                remaining = (len(todo) - processed) / rate if rate > 0 else 0
                # Rough cost: $0.0006 per row at Haiku 4.5
                cost_so_far = processed * 0.0006
                ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
                print(
                    f"  [score {ts}] {processed}/{len(todo)} | failures: {failures} | "
                    f"rate: {rate*60:.1f}/min | ETA: {remaining/60:.1f}min | "
                    f"~${cost_so_far:.2f} spent so far",
                    flush=True,
                )

    fout.close()
    print(f"\n[score] complete. {processed} processed, {failures} failures, "
          f"{time.time() - t_start:.1f}s wall time", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_path", required=True)
    parser.add_argument("--out", dest="out_path", required=True)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
