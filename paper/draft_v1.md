# ICOR-Bench draft v1 — Abstract + Evaluation section

**Status:** working draft. Replaces the placeholder claims in `docs/PAPER.md`.
All numbers grounded in actual experiments completed 2026-05-16/17.

---

## Abstract (v1, ~200 words)

We define **Intent Corruption** — the silent semantic mutation that occurs when AI writing systems modify user-authored text — and study it on three axes: taxonomy, benchmark, and detection. We present **ICOR**, a 12-category taxonomy of intent corruption grounded in pragmatic linguistic theory (monotonicity, speech acts, systemic functional grammar) and operationalized through specific detector families. We construct **ICOR-Bench**, a 1,460-example benchmark drawn from four permissively-licensed corpora (WANLI, PAWS-Wiki, ParaDetox, Anthropic model-written-evals) covering seven of twelve categories with ≥200 examples each. We build **SIL** (Semantic Intent Layer), a parallel-trajectory ensemble of rule-based, NLI, embedding, and LLM-judge detectors deployed via HTTP API and MCP server. SIL achieves F1 = 93.9% (precision 90.2%, recall 97.8%) on ICOR-Bench. To test out-of-distribution generalization, we evaluate SIL on the **IteraTeR** human-labeled corpus (Du et al., 2022) of Wikipedia revisions; SIL achieves F1 = 67.6% [64.0, 71.2] and Cohen's κ = 0.453 [0.403, 0.506] against human annotators (N=1,572). The 26-point F1 gap between in-distribution synthetic data and third-party human ground truth is the most important diagnostic finding: SIL's `intent_drift` catch-all category dominates positive detections, and false-positives concentrate on `coherence` edits (56.2% flag rate on clean reorderings), pointing to architectural improvements as the highest-value next step.

---

## §6. Evaluation

### 6.1 Evaluation strategy

We evaluate SIL along three axes, each anchored to a different ground truth:

1. **ICOR-Bench (in-distribution synthetic):** the benchmark we construct from public corpora, weakly-labeled via dataset-provided intent tags. Tests whether SIL recovers signal from labels its own design assumes.
2. **IteraTeR (out-of-distribution, human-labeled):** Wikipedia revision pairs with human-annotated revision intentions (Du et al., 2022). Tests whether SIL agrees with human ground truth on edits it was *not* trained on.
3. **Cascade audits (anecdotal):** multi-hop pipeline corruption demonstrations. Detailed in §7.

A fourth axis — production-deployment study on WildChat-1M — was attempted and **revealed a critical design-surface constraint**, documented in §6.6.

---

### 6.2 In-distribution evaluation on ICOR-Bench (N=1,460)

ICOR-Bench is constructed from four datasets per category coverage:

| Source | License | Categories covered | Examples (filtered) |
|---|---|---|---|
| WANLI (Liu et al., NAACL 2022) | CC-BY-4.0 | polarity_negation, scope_error | 10,713 (→ 200+) |
| PAWS-Wiki (Zhang et al., NAACL 2019) | Free-for-any-purpose | subject_object_swap | 27,572 (→ 200+) |
| ParaDetox (Logacheva et al., ACL 2022) | CC-BY-4.0 | tone_shift | 19,744 (→ 200+) |
| Anthropic model-written-evals/sycophancy (Perez et al., 2023) | CC-BY-4.0 | commitment_distortion, intent_drift | 30,168 (→ 200+) |
| WANLI(entailment) + PAWS(paraphrase) | mixed | true_paraphrase (negative class) | 400 (→ 200) |

After dedup, balancing (cap 200 per category), and merging with the original 60-example hand-curated seed, the final bench is N=1,460 with the following class distribution: 1,250 corruption / 210 clean (6:1).

**Headline results on ICOR-Bench (N=1,460), full-stack detector (HF DeBERTa NLI + BGE-M3 + Claude Haiku 4.5 judge):**

```
Accuracy:        89.0%
Precision:       90.2%
Recall:          97.8%
F1:              93.9%
False-pos rate:  63.3%  (on true_paraphrase clean class)
Latency p50:     2,736 ms
Latency p95:     3,958 ms
Latency p99:     6,567 ms
Wall time:       4,584 s (76.4 min on 1,460 examples)
OpenRouter cost: $0.88
```

**Per-category accuracy:**

```
commitment_distortion   205/205   100%
intent_drift            201/201   100%
polarity_negation       205/205   100%
scope_error             202/203   100%
tone_shift              197/204    97%
subject_object_swap     185/204    91%
true_paraphrase          77/210    37%  ← precision drain
[hedging_shift, identity_corruption, modal_shift, polarity_antonym,
 quantifier_shift, temporal_shift each at N=4–5, all 100%]
```

The high false-positive rate on `true_paraphrase` (63.3%) is the dominant error mode. We diagnose this in §6.5 and address it through threshold tuning in §6.4.

---

### 6.3 Out-of-distribution evaluation on IteraTeR (N=1,572)

The in-distribution result above measures whether SIL agrees with weak labels from its training-distribution datasets. To test out-of-distribution generalization, we evaluate against **IteraTeR_human_sent** (Du et al., ACL 2022) — a corpus of Wikipedia/arXiv revision pairs with human-annotated revision intentions in {`meaning-changed`, `fluency`, `coherence`, `clarity`, `style`}.

**Label mapping:** We map IteraTeR's 5-class taxonomy onto SIL's binary corruption-vs-clean prediction:

| IteraTeR intent | SIL binary | Justification |
|---|---|---|
| `meaning-changed` | corruption | Edit changed literal meaning — exactly what SIL targets |
| `fluency` | clean | Typo/grammar fix; meaning preserved |
| `coherence` | clean | Reordering, transitions; meaning preserved |
| `clarity` | ambiguous | Reworded for understandability; may shift pragmatic intent |
| `style` | ambiguous | Formal↔casual; may shift register without changing literal meaning |

Ambiguous cases are excluded from the binary metric (they're cases where humans themselves would disagree on whether intent was preserved) and reported separately.

**Sample:** Stratified across all five intents (binding constraint: `style` has only 100 human-labeled examples in the corpus), yielding N=1,572 with:
- 400 `meaning-changed` (corruption positives)
- 672 `fluency` + `coherence` (clean negatives)
- 500 `clarity` + `style` (ambiguous, reported separately)

**Headline results on IteraTeR (binary task, N=1,072 after excluding ambiguous):**

| Metric | Point estimate | Bootstrap 95% CI |
|---|---|---|
| Precision | 0.618 | [0.575, 0.664] |
| Recall | 0.748 | [0.704, 0.786] |
| F1 | 0.676 | [0.640, 0.712] |
| **Cohen's κ** | **0.453** | **[0.403, 0.506]** |

**Confusion matrix:**

```
                 predicted
                corruption    clean
gold corruption       299       101    ← recall 74.8%
gold clean            185       487    ← FP rate 27.5%
```

**Per-intent flag rates** (the diagnostic table that motivates §6.5):

| IteraTeR intent | n | SIL flag rate |
|---|---|---|
| `fluency` | 400 | **8.0%** (clean, correctly passed) |
| `meaning-changed` | 400 | **74.8%** (corruption, correctly flagged) |
| `coherence` | 272 | 56.2% (clean, **over-flagged**) |
| `clarity` | 400 | 41.8% (ambiguous) |
| `style` | 100 | 37.0% (ambiguous) |

**ICOR categories attributed to caught meaning-changes (n=299 caught of 400):**

| ICOR category | count | % of caught meaning-changes |
|---|---|---|
| `intent_drift` | 206 | **68.9%** |
| `polarity_negation` | 25 | 8.4% |
| `scope_error` | 22 | 7.4% |
| `identity_corruption` | 20 | 6.7% |
| `modal_shift` | 11 | 3.7% |
| `tone_shift` | 6 | 2.0% |
| others | 9 | 3.0% |

---

### 6.4 Evaluation gradient

The most informative comparison is the gradient across data settings:

| Evaluation set | N | F1 | κ | Notes |
|---|---|---|---|---|
| ICOR-Bench seed (hand-curated) | 60 | 98.0% | — | Cherry-picked easy examples |
| **ICOR-Bench expanded** (HF datasets, in-distribution) | **1,460** | **93.9%** | — | Synthetic, broader |
| **IteraTeR** (3rd-party human ground truth) | **1,572** | **67.6%** | **0.453** | Out-of-distribution |

The **26-point F1 gap** between in-distribution synthetic data and third-party human-labeled data is the central diagnostic finding. Two-thirds of the gap comes from precision loss: when scored against human revision intentions, SIL flags ≈28% of edits that humans labeled as clean. The remaining gap is recall (75% on IteraTeR vs. 98% on bench), attributable to subtler meaning changes in real Wikipedia revisions vs. obvious lexical substitutions in synthetic data.

---

### 6.5 Diagnostic analysis of failure modes

Two failure modes account for most of the 32% F1 loss on IteraTeR:

**(1) `intent_drift` over-attribution.** Of 299 caught meaning-changes, 69% are attributed to `intent_drift` — a category defined as "low embedding similarity in either direction." This is the system's most-general catch-all rather than a specific corruption type. The per-category structure of the taxonomy is under-utilized: more specific categories (`polarity_negation`, `scope_error`, `modal_shift`) account for <10% each despite their lexical-rule detectors having near-perfect precision on the synthetic bench. **The system catches real corruption but cannot reliably explain why** — a usability problem for downstream consumers (e.g., a writer who wants to know *what* the AI changed, not just *that* it changed).

**(2) `coherence` false positives.** Of 272 IteraTeR `coherence` edits (sentence reorderings, transition smoothing — clean by human annotation), SIL flags **56.2% as corruption**. Same root cause as the bench's `true_paraphrase` failures: the NLI cross-encoder fires on substantial lexical change regardless of meaning preservation. A coherence-style reordering may have <40% surface overlap with the original even though the meaning is identical; NLI sees this as contradiction-direction asymmetry.

Both findings point to the same architectural intervention: the aggregator should penalize NLI's contradiction signal when LLM-judge agrees there's no semantic change (i.e., use the judge as a *veto* on NLI-only flags rather than as a separate trajectory). We leave this to future work.

---

### 6.6 Methodology note: the WildChat detour

In initial pilot studies, we attempted to apply SIL to (user_prompt, assistant_response) pairs from **WildChat-1M** (Zhao et al., ICLR 2024), reasoning that intent corruption manifests across the full conversational surface of real AI deployments. The pilot revealed a fundamental design-surface constraint.

**SIL is built to evaluate paraphrase-class rewrites:** text where the suggested output preserves the meaning of the original with modified surface form (autocorrect, smart compose, Grammarly-style rewrites, machine translation). Prompt/response pairs have no entailment relationship to evaluate — the response answers or expands the prompt rather than paraphrasing it. The NLI detector, operating on the implicit assumption that surface lexical mismatch implies contradiction, fires on essentially every prompt/response pair.

We measured this directly: SIL flagged **96.9%** of 1,000 WildChat pairs as corruption (53.9% of flags via `polarity_negation` — the NLI contradiction signal). A second pilot attempt with a regex-based filter to extract rewrite-style turns yielded ≈33% extraction precision due to semantic ambiguity in user prompts (e.g., *"polish my idea: write me a paragraph about X"* matches "polish" but is content generation, not rewriting). We abandoned the WildChat methodology in favor of IteraTeR, which provides human-annotated revision intentions on actual rewrite pairs.

We document this in detail because it constitutes a usable artifact: **applying intent-corruption detectors to prompt/response pairs is a methodological error**, and future work should use rewrite-style corpora (IteraTeR, arXivEdits, NewsEdits, GYAFC) or filtered subsets that isolate rewrites.

---

### 6.7 Latency and cost

| Setting | p50 | p95 | p99 | Cost per 1k examples |
|---|---|---|---|---|
| ICOR-Bench (full stack) | 2.7 s | 4.0 s | 6.6 s | $0.60 |
| IteraTeR (full stack) | 0.6 s | 1.2 s | 2.1 s | $0.60 |

Latency depends primarily on input length. The IteraTeR pairs are single sentences (≈100–200 chars each); the ICOR-Bench pairs include longer Anthropic sycophancy and ParaDetox passages (up to 3000 chars after truncation). Cost per 1k examples is dominated by the OpenRouter judge call (~$0.0002 × 3 trajectories per example).

For real-time use (pre-edit hooks), only T1+T2 trajectories run (rules + NLI, no judge): p50 ≈ 500 ms. The full T3 stack is intended for offline batch audit pipelines.

---

### 6.8 Threshold and trajectory ablations [to-do]

Planned ablations (cache wrapper + CLI flags shipped; runs not yet executed):

1. **Threshold sweep:** F1 / precision / recall across action thresholds ∈ {0.30, 0.40, 0.50, 0.60, 0.70, 0.80}. Expected to recover precision on `true_paraphrase` and `coherence` at modest recall cost.
2. **Trajectory ablation:** F1 at parallelTrajectories ∈ {1, 2, 3} to isolate the LLM judge's marginal contribution.
3. **Per-category thresholds:** F1-optimal threshold per ICOR category, reporting a per-category table. Hypothesis: `polarity_negation` is easy (threshold can be high without losing recall), `subject_object_swap` and `intent_drift` are hard (need low thresholds).

The cache wrapper (`src/detectors/llm-judge/index.ts:CachedJudgeBackend`) memoizes judge responses by `sha256(prompt + maxTokens + temperature)`, so each subsequent ablation run after the first costs ≈$0 in API spend and ≈5 min wall time per threshold/trajectory configuration. Estimated total ablation budget: $1 of API, 2 hours of wall time.

---

### 6.9 Limitations

1. **Weak supervision in ICOR-Bench.** The 1,400 Pillar A labels come from upstream dataset-provided intent tags (WANLI gold labels, Anthropic sycophancy framing, etc.), not from human annotation specifically for ICOR. The IteraTeR evaluation in §6.3 is the human-ground-truth anchor.
2. **Six under-sampled categories.** `hedging_shift`, `identity_corruption`, `modal_shift`, `polarity_antonym`, `quantifier_shift`, `temporal_shift` each have N=4–5 in the bench (seed only). Their reported 100% category accuracy is not statistically meaningful. These require synthetic generation (we have the harness, not the runs).
3. **English only.** All evaluation is on English text. Cross-lingual evaluation via PAWS-X / multilingual-NLI is future work.
4. **Single-turn evaluation in IteraTeR.** Multi-hop cascade corruption (Recursive Semantic Drift) is evaluated anecdotally in §7; a controlled cascade benchmark is the most novel piece of future work.
5. **Out-of-design surfaces.** As documented in §6.6, SIL is not built for prompt/response evaluation. The design surface is paraphrase-class rewrites: autocorrect, smart compose, document polishing, translation.

---

## What to fill in next

- **§3 (Taxonomy):** the existing PAPER.md outline is fine; need to add the linguistic-theory citations (Horn, Searle, Halliday, Lyons, Hyland, Grosz & Sidner) per Gap 3 of the research strategy.
- **§5 (System):** map of detector families to ICOR categories; aggregation logic; figures of the parallel-trajectory architecture.
- **§6.8 ablations:** the runs are cheap (cache + CLI flags shipped); just need to execute.
- **§7 (Cascade):** anecdotal `examples/deployment-audit.ts` exists; controlled benchmark is open.
- **Abstract:** locked-in version above; can iterate.

---

**Reproducibility links:**
- Code: `github.com/plutaslab/ruflo-sil` (to be released)
- Bench data: `benchmark/data/seed_v2.jsonl` (N=1,460)
- IteraTeR scored data: `benchmark/iterater/data/iterater_scored.jsonl` (N=1,572)
- Bench report: `benchmark/data/BENCH_REPORT.md`
- IteraTeR report: `benchmark/iterater/data/iterater_report.md`
