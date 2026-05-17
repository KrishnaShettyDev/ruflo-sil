"""
Parse the scoring log + scored JSONL into a reproducibility throughput log.

Emits benchmark/wildchat/data/throughput_log.csv with columns:
  timestamp, rows_completed, rate_per_min, source

Sources are:
  - "log_ts": parsed directly from "[score <ISO>] N/total" lines in the log
  - "row_ts": derived from scored_at field on individual JSONL rows (binned per 25)
  - "inferred": for older runs without timestamps, back-computed from rate field

The CSV is suitable for the paper's reproducibility figure (throughput vs. wall time).

Run:
    python3 benchmark/wildchat/parse_throughput.py \\
        --log /path/to/score_run.output \\
        --scored benchmark/wildchat/data/wildchat_scored.jsonl
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_SCORED = DATA_DIR / "wildchat_scored.jsonl"
DEFAULT_OUT = DATA_DIR / "throughput_log.csv"


# Matches lines from the new (timestamped) score format:
#   "[score 2026-05-17T12:34:56+00:00] 100/656 | failures: 0 | rate: 5.3/min | ..."
LOG_TIMESTAMPED = re.compile(
    r"\[score (?P<ts>\d{4}-\d{2}-\d{2}T[\d:+-]+)\]\s+"
    r"(?P<done>\d+)/(?P<total>\d+)\s+\|\s+failures:\s+(?P<fail>\d+)\s+\|\s+"
    r"rate:\s+(?P<rate>[\d.]+)/min"
)

# Matches the older (non-timestamped) format:
#   "[score] 100/656 | failures: 0 | rate: 5.3/min | ..."
LOG_UNTIMESTAMPED = re.compile(
    r"\[score\]\s+(?P<done>\d+)/(?P<total>\d+)\s+\|\s+failures:\s+(?P<fail>\d+)\s+\|\s+"
    r"rate:\s+(?P<rate>[\d.]+)/min"
)


def parse_log(log_path: Path) -> list[dict]:
    """Pull progress lines out of the score-run log. Prefer timestamped."""
    if not log_path or not log_path.exists():
        return []
    rows: list[dict] = []
    for line in log_path.read_text(errors="ignore").splitlines():
        m = LOG_TIMESTAMPED.search(line)
        if m:
            rows.append({
                "timestamp": m.group("ts"),
                "rows_completed": int(m.group("done")),
                "total": int(m.group("total")),
                "failures": int(m.group("fail")),
                "rate_per_min": float(m.group("rate")),
                "source": "log_ts",
            })
            continue
        m = LOG_UNTIMESTAMPED.search(line)
        if m:
            rows.append({
                "timestamp": None,  # filled in pass 2
                "rows_completed": int(m.group("done")),
                "total": int(m.group("total")),
                "failures": int(m.group("fail")),
                "rate_per_min": float(m.group("rate")),
                "source": "inferred",
            })
    # Pass 2: for rows with source=inferred, back-compute timestamps
    # using rate. Find the latest timestamped row (or use scored.jsonl earliest
    # timestamp) as the anchor and walk forward/backward.
    if rows:
        anchored = [r for r in rows if r["timestamp"] is not None]
        anchor = anchored[0] if anchored else None
        if anchor is None:
            # No timestamps at all — anchor at run end using current time
            t_end = datetime.now(timezone.utc)
            last = rows[-1]
            # Walk backward
            t_prev = t_end
            for r in reversed(rows):
                r["timestamp"] = t_prev.isoformat(timespec="seconds")
                if r["rate_per_min"] > 0 and r is not last:
                    delta_rows = last["rows_completed"] - r["rows_completed"]
                    t_prev = t_prev - timedelta(minutes=delta_rows / r["rate_per_min"])
        else:
            # Walk from the anchor in both directions
            anchor_t = datetime.fromisoformat(anchor["timestamp"])
            anchor_done = anchor["rows_completed"]
            for r in rows:
                if r["timestamp"] is not None:
                    continue
                if r["rate_per_min"] <= 0:
                    r["timestamp"] = anchor_t.isoformat(timespec="seconds")
                    continue
                # delta time = delta rows / rate
                delta_rows = anchor_done - r["rows_completed"]
                delta_min = delta_rows / r["rate_per_min"]
                r["timestamp"] = (
                    anchor_t - timedelta(minutes=delta_min)
                ).isoformat(timespec="seconds")
    return rows


def parse_scored_jsonl(p: Path, bucket: int = 25) -> list[dict]:
    """Build per-bucket rows from the scored JSONL using scored_at field."""
    if not p.exists():
        return []
    rows: list[dict] = []
    times: list[datetime] = []
    for line in p.read_text(errors="ignore").splitlines():
        if not line.strip():
            continue
        try:
            ex = json.loads(line)
        except json.JSONDecodeError:
            continue
        st = ex.get("scored_at")
        if not st:
            times.append(None)
            continue
        try:
            times.append(datetime.fromisoformat(st))
        except ValueError:
            times.append(None)

    # Bucket: emit (timestamp, rows_completed, rate_per_min) per `bucket` rows
    out: list[dict] = []
    last_t: datetime | None = None
    for i, t in enumerate(times, start=1):
        if i % bucket != 0:
            continue
        if t is None:
            continue
        rate = None
        if last_t is not None:
            dt = (t - last_t).total_seconds() / 60.0
            if dt > 0:
                rate = bucket / dt
        out.append({
            "timestamp": t.isoformat(timespec="seconds"),
            "rows_completed": i,
            "total": None,
            "failures": None,
            "rate_per_min": rate if rate is not None else 0.0,
            "source": "row_ts",
        })
        last_t = t
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", default=None,
                        help="path to the score-run log (the file with [score] N/total lines)")
    parser.add_argument("--scored", default=str(DEFAULT_SCORED))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--bucket", type=int, default=25)
    args = parser.parse_args()

    log_rows: list[dict] = []
    if args.log:
        log_rows = parse_log(Path(args.log))

    row_rows = parse_scored_jsonl(Path(args.scored), bucket=args.bucket)

    # Merge: prefer row_ts (most accurate), fall back to log entries
    all_rows = row_rows + log_rows
    if not all_rows:
        print("[throughput] no data to parse", file=sys.stderr)
        sys.exit(2)
    # Dedup by rows_completed, preferring row_ts > log_ts > inferred
    rank = {"row_ts": 0, "log_ts": 1, "inferred": 2}
    seen: dict[int, dict] = {}
    for r in all_rows:
        key = r["rows_completed"]
        if key not in seen or rank[r["source"]] < rank[seen[key]["source"]]:
            seen[key] = r
    merged = sorted(seen.values(), key=lambda r: r["rows_completed"])

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["timestamp", "rows_completed", "total",
                                           "failures", "rate_per_min", "source"])
        w.writeheader()
        for r in merged:
            w.writerow(r)
    print(f"[throughput] wrote {len(merged)} rows → {out_path}")
    sources = {}
    for r in merged:
        sources[r["source"]] = sources.get(r["source"], 0) + 1
    print(f"[throughput] sources: {sources}")


if __name__ == "__main__":
    main()
