"""
Generate publication-quality figures from the analyzed WildChat results.

Reads CSV tables produced by analyze_wildchat.py. Writes PDFs to:
    benchmark/wildchat/data/figures/

Run:
    python3 benchmark/wildchat/plot_wildchat.py
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent / "data"
TABLES_DIR = DATA_DIR / "tables"
FIG_DIR = DATA_DIR / "figures"
FIG_DIR.mkdir(parents=True, exist_ok=True)

plt.rcParams.update({
    "font.family": "serif",
    "font.size": 11,
    "axes.labelsize": 12,
    "axes.titlesize": 12,
    "xtick.labelsize": 10,
    "ytick.labelsize": 10,
    "legend.fontsize": 10,
    "figure.dpi": 100,
    "savefig.dpi": 300,
})


def _bar_with_ci(df: pd.DataFrame, key: str, out_path: Path, xlabel: str) -> None:
    if df.empty:
        return
    df = df.sort_values("corruption_rate", ascending=True)
    fig, ax = plt.subplots(figsize=(8, 6))
    y_pos = range(len(df))
    rates = df["corruption_rate"].to_numpy() * 100
    lo = df["ci_lo"].to_numpy() * 100
    hi = df["ci_hi"].to_numpy() * 100
    err_lo = rates - lo
    err_hi = hi - rates
    ax.barh(y_pos, rates, xerr=[err_lo, err_hi], align="center",
            color="#4a7ebb", error_kw={"ecolor": "#222", "capsize": 4})
    ax.set_yticks(list(y_pos))
    ax.set_yticklabels([f"{v} (n={n})" for v, n in zip(df[key], df["n"])])
    ax.set_xlabel("Corruption rate (%)")
    ax.set_ylabel(xlabel)
    ax.grid(axis="x", alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)
    print(f"  wrote {out_path}")


def fig_corruption_by_model():
    f = TABLES_DIR / "by_model.csv"
    if not f.exists():
        return
    df = pd.read_csv(f)
    _bar_with_ci(df, "model", FIG_DIR / "figure_1_corruption_rate_by_model.pdf", "Model")


def fig_corruption_by_task():
    f = TABLES_DIR / "by_task.csv"
    if not f.exists():
        return
    df = pd.read_csv(f)
    _bar_with_ci(df, "task_type", FIG_DIR / "figure_2_corruption_rate_by_task.pdf", "Task type")


def fig_category_heatmap():
    f = TABLES_DIR / "model_by_category.csv"
    if not f.exists():
        return
    df = pd.read_csv(f)
    if df.empty:
        return
    pivot = df.pivot(index="category", columns="model", values="rate").fillna(0)
    fig, ax = plt.subplots(figsize=(8, 6))
    im = ax.imshow(pivot.values * 100, aspect="auto", cmap="Blues")
    ax.set_xticks(range(len(pivot.columns)))
    ax.set_xticklabels(pivot.columns, rotation=45, ha="right")
    ax.set_yticks(range(len(pivot.index)))
    ax.set_yticklabels(pivot.index)
    ax.set_xlabel("Model")
    ax.set_ylabel("ICOR category")
    cbar = fig.colorbar(im, ax=ax)
    cbar.set_label("Corruption rate (%)")
    # Annotate cells
    for i in range(pivot.shape[0]):
        for j in range(pivot.shape[1]):
            v = pivot.values[i, j] * 100
            ax.text(j, i, f"{v:.1f}", ha="center", va="center",
                    color="white" if v > pivot.values.max() * 50 else "black", fontsize=9)
    fig.tight_layout()
    out = FIG_DIR / "figure_3_category_heatmap_by_model.pdf"
    fig.savefig(out)
    plt.close(fig)
    print(f"  wrote {out}")


def fig_risk_distribution():
    f = TABLES_DIR / "risk_by_action.csv"
    if not f.exists():
        return
    df = pd.read_csv(f)
    fig, ax = plt.subplots(figsize=(8, 6))
    colors = {"pass": "#7fb878", "warn": "#f0c050", "block": "#d05858"}
    bins = [i / 20 for i in range(21)]  # 0.05 bins
    for _, row in df.iterrows():
        action = row["action"]
        risks = json.loads(row["risks"])
        if not risks:
            continue
        ax.hist(risks, bins=bins, alpha=0.6, label=f"{action} (n={len(risks)})",
                color=colors.get(action, "gray"), edgecolor="black", linewidth=0.5)
    ax.set_xlabel("Overall risk score")
    ax.set_ylabel("Count")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    out = FIG_DIR / "figure_4_risk_distribution.pdf"
    fig.savefig(out)
    plt.close(fig)
    print(f"  wrote {out}")


def main() -> None:
    print(f"[plot] writing to {FIG_DIR}")
    fig_corruption_by_model()
    fig_corruption_by_task()
    fig_category_heatmap()
    fig_risk_distribution()
    print("[plot] done")


if __name__ == "__main__":
    main()
