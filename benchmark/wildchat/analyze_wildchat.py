"""
Analyze the SIL-scored WildChat sample.

Computes:
  (a) Overall corruption rate with bootstrap 95% CI
  (b) Corruption rate stratified by model
  (c) Corruption rate stratified by task_type
  (d) Corruption rate stratified by length_bucket
  (e) Top-category distribution on flagged rows
  (f) Cross-model × category corruption rate matrix
  (g) Severity distribution (risk for warn vs block)

Writes:
  - Markdown report to stdout AND benchmark/wildchat/data/wildchat_report.md
  - Per-stratum CSV tables to benchmark/wildchat/data/tables/

Run:
    python3 benchmark/wildchat/analyze_wildchat.py
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from io import StringIO
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
TABLES_DIR = DATA_DIR / "tables"
TABLES_DIR.mkdir(parents=True, exist_ok=True)


def load_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


def bootstrap_ci(values: list[float], n_boot: int = 1000, seed: int = 42) -> tuple[float, float, float]:
    import numpy as np
    rng = np.random.default_rng(seed)
    arr = np.asarray(values, dtype=float)
    if len(arr) == 0:
        return 0.0, 0.0, 0.0
    mean = float(arr.mean())
    boot = rng.choice(arr, size=(n_boot, len(arr)), replace=True).mean(axis=1)
    lo, hi = float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))
    return mean, lo, hi


def corruption_indicator(row: dict) -> int:
    return 0 if row.get("action") == "pass" else 1


def write_md_section(buf: StringIO, title: str, body: str) -> None:
    buf.write(f"\n## {title}\n\n")
    buf.write(body)
    buf.write("\n")


def stratified_table(rows: list[dict], key: str) -> list[dict]:
    import pandas as pd
    df = pd.DataFrame(rows)
    if df.empty:
        return []
    df["corrupted"] = df["action"].apply(lambda a: 0 if a == "pass" else 1)
    stats = []
    for stratum, sub in df.groupby(key):
        vals = sub["corrupted"].tolist()
        mean, lo, hi = bootstrap_ci(vals)
        stats.append({
            key: stratum,
            "n": len(vals),
            "corruption_rate": mean,
            "ci_lo": lo,
            "ci_hi": hi,
            "n_block": int((sub["action"] == "block").sum()),
            "n_warn": int((sub["action"] == "warn").sum()),
            "n_pass": int((sub["action"] == "pass").sum()),
        })
    stats.sort(key=lambda r: -r["corruption_rate"])
    return stats


def category_by_model(rows: list[dict]) -> dict:
    """For each (model, category), fraction of model's rows where this category was top."""
    by_model = defaultdict(lambda: defaultdict(int))
    totals = Counter()
    for r in rows:
        m = r.get("model", "unknown")
        totals[m] += 1
        if r.get("action") != "pass" and r.get("top_category"):
            by_model[m][r["top_category"]] += 1
    result = {}
    for m, cats in by_model.items():
        if totals[m] == 0:
            continue
        result[m] = {c: cats[c] / totals[m] for c in cats}
    return result


def render_table(rows: list[dict], cols: list[str], fmt: dict[str, str]) -> str:
    if not rows:
        return "_(no data)_\n"
    header = "| " + " | ".join(cols) + " |\n"
    sep = "|" + "|".join("---" for _ in cols) + "|\n"
    body = ""
    for r in rows:
        cells = []
        for c in cols:
            v = r.get(c)
            f = fmt.get(c, "{}")
            cells.append(f.format(v) if v is not None else "—")
        body += "| " + " | ".join(cells) + " |\n"
    return header + sep + body


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_path",
                        default=str(DATA_DIR / "wildchat_scored.jsonl"))
    parser.add_argument("--out", dest="out_path",
                        default=str(DATA_DIR / "wildchat_report.md"))
    args = parser.parse_args()

    in_path = Path(args.in_path)
    rows = load_jsonl(in_path)
    if not rows:
        print(f"[analyze] no rows in {in_path}", file=sys.stderr)
        sys.exit(2)

    import pandas as pd

    buf = StringIO()
    buf.write(f"# WildChat × SIL Measurement Report\n\n")
    buf.write(f"**N scored:** {len(rows)}\n")
    buf.write(f"**Source:** allenai/WildChat-1M (CC-BY-4.0)\n")
    buf.write(f"**Evaluator:** SIL hosted (HF DeBERTa NLI + BGE embeddings + OpenRouter Claude Haiku 4.5)\n")

    # (a) Overall corruption rate
    overall = [corruption_indicator(r) for r in rows]
    mean, lo, hi = bootstrap_ci(overall)
    n_block = sum(1 for r in rows if r["action"] == "block")
    n_warn = sum(1 for r in rows if r["action"] == "warn")
    n_pass = sum(1 for r in rows if r["action"] == "pass")
    body = (
        f"**Overall corruption rate: {mean*100:.1f}%** (95% CI [{lo*100:.1f}, {hi*100:.1f}])\n\n"
        f"- block: {n_block} ({n_block/len(rows)*100:.1f}%)\n"
        f"- warn:  {n_warn} ({n_warn/len(rows)*100:.1f}%)\n"
        f"- pass:  {n_pass} ({n_pass/len(rows)*100:.1f}%)\n"
    )
    write_md_section(buf, "Overall", body)

    # (b) By model
    by_model = stratified_table(rows, "model")
    body = render_table(by_model, ["model", "n", "corruption_rate", "ci_lo", "ci_hi", "n_block", "n_warn"],
                        {"corruption_rate": "{:.1%}", "ci_lo": "{:.1%}", "ci_hi": "{:.1%}"})
    write_md_section(buf, "Corruption rate by model", body)
    pd.DataFrame(by_model).to_csv(TABLES_DIR / "by_model.csv", index=False)

    # (c) By task type
    by_task = stratified_table(rows, "task_type")
    body = render_table(by_task, ["task_type", "n", "corruption_rate", "ci_lo", "ci_hi", "n_block", "n_warn"],
                        {"corruption_rate": "{:.1%}", "ci_lo": "{:.1%}", "ci_hi": "{:.1%}"})
    write_md_section(buf, "Corruption rate by task type", body)
    pd.DataFrame(by_task).to_csv(TABLES_DIR / "by_task.csv", index=False)

    # (d) By length bucket
    by_len = stratified_table(rows, "length_bucket")
    body = render_table(by_len, ["length_bucket", "n", "corruption_rate", "ci_lo", "ci_hi", "n_block", "n_warn"],
                        {"corruption_rate": "{:.1%}", "ci_lo": "{:.1%}", "ci_hi": "{:.1%}"})
    write_md_section(buf, "Corruption rate by length bucket", body)
    pd.DataFrame(by_len).to_csv(TABLES_DIR / "by_length.csv", index=False)

    # (e) Top-category distribution on flagged rows
    flagged = [r for r in rows if r.get("action") != "pass" and r.get("top_category")]
    cat_counts = Counter(r["top_category"] for r in flagged)
    if cat_counts:
        total = sum(cat_counts.values())
        cat_table = [{"category": k, "n_flagged": v, "pct_of_flags": v / total}
                     for k, v in cat_counts.most_common()]
        body = render_table(cat_table, ["category", "n_flagged", "pct_of_flags"],
                            {"pct_of_flags": "{:.1%}"})
    else:
        body = "_(no flagged rows)_\n"
    write_md_section(buf, "Top ICOR category on flagged conversations", body)
    pd.DataFrame(cat_table if cat_counts else []).to_csv(TABLES_DIR / "top_categories.csv", index=False)

    # (f) Cross-model × category heatmap data
    cm = category_by_model(rows)
    if cm:
        all_cats = sorted({c for d in cm.values() for c in d})
        body = "| model | " + " | ".join(all_cats) + " |\n"
        body += "|---|" + "|".join("---" for _ in all_cats) + "|\n"
        for m, d in sorted(cm.items()):
            cells = [f"{d.get(c, 0)*100:.1f}%" for c in all_cats]
            body += f"| {m} | " + " | ".join(cells) + " |\n"
    else:
        body = "_(no data)_\n"
    write_md_section(buf, "Cross-model × ICOR category corruption rate", body)
    # CSV form
    if cm:
        cm_rows = []
        for m, d in cm.items():
            for c, v in d.items():
                cm_rows.append({"model": m, "category": c, "rate": v})
        pd.DataFrame(cm_rows).to_csv(TABLES_DIR / "model_by_category.csv", index=False)

    # (g) Severity distribution
    risk_warn = [r["overall_risk"] for r in rows if r["action"] == "warn"]
    risk_block = [r["overall_risk"] for r in rows if r["action"] == "block"]
    risk_pass = [r["overall_risk"] for r in rows if r["action"] == "pass"]
    body = (
        f"| action | n | mean risk | median risk | min | max |\n"
        f"|---|---|---|---|---|---|\n"
    )
    for label, vals in [("pass", risk_pass), ("warn", risk_warn), ("block", risk_block)]:
        if not vals:
            body += f"| {label} | 0 | — | — | — | — |\n"
            continue
        import statistics
        body += (
            f"| {label} | {len(vals)} | {sum(vals)/len(vals):.3f} | "
            f"{statistics.median(vals):.3f} | {min(vals):.3f} | {max(vals):.3f} |\n"
        )
    write_md_section(buf, "Risk distribution by action", body)
    pd.DataFrame([{"action": "pass", "risks": json.dumps(risk_pass)},
                  {"action": "warn", "risks": json.dumps(risk_warn)},
                  {"action": "block", "risks": json.dumps(risk_block)}]
                 ).to_csv(TABLES_DIR / "risk_by_action.csv", index=False)

    report = buf.getvalue()
    Path(args.out_path).write_text(report)
    print(report)
    print(f"\n[analyze] wrote report → {args.out_path}", file=sys.stderr)
    print(f"[analyze] wrote tables → {TABLES_DIR}", file=sys.stderr)


if __name__ == "__main__":
    main()
