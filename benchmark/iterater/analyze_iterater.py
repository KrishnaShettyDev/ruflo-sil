"""
Analyze the SIL-scored IteraTeR sample.

Reports:
  1. Binary confusion matrix (corruption vs clean, ambiguous excluded)
  2. Precision / Recall / F1 with bootstrap 95% CIs (binary task)
  3. Cohen's κ between SIL and IteraTeR human labels (binary task)
  4. Stratified breakdown by IteraTeR intent (meaning-changed / fluency /
     coherence / clarity / style): what does SIL do on each?
  5. Per-ICOR-category breakdown on meaning-changed examples: which categories
     fire most on the gold-positive class?

Writes:
  - Markdown report → benchmark/iterater/data/iterater_report.md
  - CSV tables    → benchmark/iterater/data/tables/

Run:
    python3 benchmark/iterater/analyze_iterater.py
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


def bootstrap_metric(values_fn, n_boot=1000, seed=42):
    """values_fn returns (precision, recall, f1) given a list of rows."""
    import numpy as np
    rng = np.random.default_rng(seed)
    return rng


def predicted_binary(row: dict) -> str:
    return "clean" if row.get("action") == "pass" else "corruption"


def cohens_kappa(pairs: list[tuple[str, str]]) -> float:
    """pairs of (rater_a, rater_b) labels. Returns κ on the 2-class problem."""
    if not pairs:
        return 0.0
    n = len(pairs)
    obs_agree = sum(1 for a, b in pairs if a == b) / n
    # Marginal frequencies
    classes = set(a for a, _ in pairs) | set(b for _, b in pairs)
    chance = 0.0
    for c in classes:
        pa = sum(1 for a, _ in pairs if a == c) / n
        pb = sum(1 for _, b in pairs if b == c) / n
        chance += pa * pb
    if chance >= 1.0:
        return 1.0
    return (obs_agree - chance) / (1.0 - chance)


def precision_recall_f1(rows: list[dict]) -> tuple[float, float, float, dict]:
    tp = fp = tn = fn = 0
    for r in rows:
        gold = r["gold_binary"]
        pred = predicted_binary(r)
        if gold == "corruption" and pred == "corruption":
            tp += 1
        elif gold == "clean" and pred == "corruption":
            fp += 1
        elif gold == "clean" and pred == "clean":
            tn += 1
        elif gold == "corruption" and pred == "clean":
            fn += 1
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec  = tp / (tp + fn) if (tp + fn) else 0.0
    f1   = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    return prec, rec, f1, {"tp": tp, "fp": fp, "tn": tn, "fn": fn}


def bootstrap_ci(rows: list[dict], stat_fn, n_boot=1000, seed=42):
    import numpy as np
    rng = np.random.default_rng(seed)
    point = stat_fn(rows)
    if not rows:
        return point, point, point
    n = len(rows)
    boot = []
    for _ in range(n_boot):
        idx = rng.integers(0, n, n)
        sample = [rows[i] for i in idx]
        boot.append(stat_fn(sample))
    return point, float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_path",
                        default=str(DATA_DIR / "iterater_scored.jsonl"))
    parser.add_argument("--out", dest="out_path",
                        default=str(DATA_DIR / "iterater_report.md"))
    args = parser.parse_args()

    in_path = Path(args.in_path)
    rows = load_jsonl(in_path)
    if not rows:
        print(f"[analyze] no rows in {in_path}", file=sys.stderr)
        sys.exit(2)

    import pandas as pd

    buf = StringIO()
    buf.write("# IteraTeR × SIL Evaluation Report\n\n")
    buf.write(f"**N scored:** {len(rows)}\n")
    buf.write(f"**Source:** wanyu/IteraTeR_human_sent (Du et al., ACL 2022, Apache-2.0)\n")
    buf.write(f"**Evaluator:** SIL hosted (HF DeBERTa NLI + BGE embeddings + OpenRouter Claude Haiku 4.5)\n")
    buf.write("**Surface:** document\n\n")
    buf.write("**Label mapping:**\n")
    buf.write("- `meaning-changed` → corruption (positive class)\n")
    buf.write("- `fluency`, `coherence` → clean (negative class)\n")
    buf.write("- `clarity`, `style` → ambiguous (reported separately; excluded from binary)\n\n")

    # ----- Binary task: corruption vs clean -----
    binary_rows = [r for r in rows if r["gold_binary"] != "ambiguous"]
    ambig_rows  = [r for r in rows if r["gold_binary"] == "ambiguous"]

    buf.write("## 1. Binary task — corruption vs clean (ambiguous excluded)\n\n")
    buf.write(f"**N in binary task:** {len(binary_rows)} "
              f"(corruption={sum(1 for r in binary_rows if r['gold_binary']=='corruption')}, "
              f"clean={sum(1 for r in binary_rows if r['gold_binary']=='clean')})\n\n")

    if binary_rows:
        prec, rec, f1, cm = precision_recall_f1(binary_rows)
        # bootstrap CIs
        _, prec_lo, prec_hi = bootstrap_ci(binary_rows, lambda r: precision_recall_f1(r)[0])
        _, rec_lo,  rec_hi  = bootstrap_ci(binary_rows, lambda r: precision_recall_f1(r)[1])
        _, f1_lo,   f1_hi   = bootstrap_ci(binary_rows, lambda r: precision_recall_f1(r)[2])
        pairs = [(r["gold_binary"], predicted_binary(r)) for r in binary_rows]
        kappa = cohens_kappa(pairs)
        _, k_lo, k_hi = bootstrap_ci(binary_rows,
            lambda r: cohens_kappa([(x["gold_binary"], predicted_binary(x)) for x in r]))

        buf.write("### Confusion matrix\n\n")
        buf.write("```\n")
        buf.write("                 predicted\n")
        buf.write("                corruption    clean\n")
        buf.write(f"gold corruption    {cm['tp']:>6}     {cm['fn']:>6}\n")
        buf.write(f"gold clean         {cm['fp']:>6}     {cm['tn']:>6}\n")
        buf.write("```\n\n")
        buf.write("### Metrics\n\n")
        buf.write(f"| metric | point | 95% CI |\n|---|---|---|\n")
        buf.write(f"| precision    | {prec:.3f} | [{prec_lo:.3f}, {prec_hi:.3f}] |\n")
        buf.write(f"| recall       | {rec:.3f} | [{rec_lo:.3f}, {rec_hi:.3f}] |\n")
        buf.write(f"| F1           | {f1:.3f} | [{f1_lo:.3f}, {f1_hi:.3f}] |\n")
        buf.write(f"| Cohen's κ    | {kappa:.3f} | [{k_lo:.3f}, {k_hi:.3f}] |\n\n")

        pd.DataFrame([{
            "metric": "precision", "point": prec, "ci_lo": prec_lo, "ci_hi": prec_hi,
        }, {"metric": "recall", "point": rec, "ci_lo": rec_lo, "ci_hi": rec_hi,
        }, {"metric": "f1", "point": f1, "ci_lo": f1_lo, "ci_hi": f1_hi,
        }, {"metric": "kappa", "point": kappa, "ci_lo": k_lo, "ci_hi": k_hi}]).to_csv(
            TABLES_DIR / "binary_metrics.csv", index=False)

    # ----- Per-intent stratified -----
    buf.write("## 2. SIL behavior stratified by IteraTeR intent\n\n")
    buf.write("For each human-labeled intent, what fraction did SIL flag as corruption?\n\n")
    buf.write("| intent | n | flag rate (block+warn) | n_block | n_warn | n_pass |\n")
    buf.write("|---|---|---|---|---|---|\n")
    rows_per_intent = []
    for intent in ["meaning-changed", "fluency", "coherence", "clarity", "style"]:
        sub = [r for r in rows if r["gold_intent"] == intent]
        if not sub:
            buf.write(f"| {intent} | 0 | — | — | — | — |\n")
            continue
        n_block = sum(1 for r in sub if r["action"] == "block")
        n_warn  = sum(1 for r in sub if r["action"] == "warn")
        n_pass  = sum(1 for r in sub if r["action"] == "pass")
        flag_rate = (n_block + n_warn) / len(sub)
        buf.write(f"| {intent} | {len(sub)} | {flag_rate:.1%} | {n_block} | {n_warn} | {n_pass} |\n")
        rows_per_intent.append({"intent": intent, "n": len(sub),
                                "flag_rate": flag_rate, "n_block": n_block,
                                "n_warn": n_warn, "n_pass": n_pass})
    pd.DataFrame(rows_per_intent).to_csv(TABLES_DIR / "by_intent.csv", index=False)
    buf.write("\n")

    # ----- Per-ICOR-category breakdown on meaning-changed -----
    buf.write("## 3. Which ICOR categories fire on meaning-changed examples?\n\n")
    mc_rows = [r for r in rows if r["gold_intent"] == "meaning-changed"]
    if mc_rows:
        cat_counter = Counter()
        for r in mc_rows:
            if r.get("top_category") and r.get("action") != "pass":
                cat_counter[r["top_category"]] += 1
        total = sum(cat_counter.values())
        if total > 0:
            buf.write(f"On the {len(mc_rows)} `meaning-changed` examples, "
                      f"{total} were flagged. Top categories:\n\n")
            buf.write("| ICOR category | count | % of meaning-changed flags |\n|---|---|---|\n")
            rows_for_csv = []
            for cat, cnt in cat_counter.most_common():
                buf.write(f"| {cat} | {cnt} | {cnt/total:.1%} |\n")
                rows_for_csv.append({"category": cat, "count": cnt, "pct": cnt/total})
            pd.DataFrame(rows_for_csv).to_csv(TABLES_DIR / "meaning_changed_categories.csv", index=False)
        else:
            buf.write("_(no meaning-changed examples were flagged)_\n")
    else:
        buf.write("_(no meaning-changed examples in this sample)_\n")
    buf.write("\n")

    # ----- Ambiguous breakdown -----
    if ambig_rows:
        buf.write("## 4. Ambiguous slice (clarity / style edits)\n\n")
        buf.write("These IteraTeR intent labels modify surface form without explicitly "
                  "changing literal meaning, but may shift pragmatic intent (the kind "
                  "of edits the SIL taxonomy argues count as corruption). Reported "
                  "separately rather than binned into the binary task.\n\n")
        for intent in ["clarity", "style"]:
            sub = [r for r in ambig_rows if r["gold_intent"] == intent]
            if not sub:
                continue
            n_block = sum(1 for r in sub if r["action"] == "block")
            n_warn  = sum(1 for r in sub if r["action"] == "warn")
            n_pass  = sum(1 for r in sub if r["action"] == "pass")
            flag_rate = (n_block + n_warn) / len(sub)
            buf.write(f"- **{intent}** (n={len(sub)}): SIL flag rate = {flag_rate:.1%} "
                      f"(block={n_block}, warn={n_warn}, pass={n_pass})\n")

    report = buf.getvalue()
    Path(args.out_path).write_text(report)
    print(report)
    print(f"\n[analyze] wrote report → {args.out_path}", file=sys.stderr)
    print(f"[analyze] wrote tables → {TABLES_DIR}", file=sys.stderr)


if __name__ == "__main__":
    main()
