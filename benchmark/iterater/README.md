# IteraTeR × SIL Evaluation

Ground-truth-anchored evaluation of SIL against human-annotated revision intentions on the **IteraTeR human-labeled subset** (Du et al., ACL 2022).

## Why IteraTeR

Unlike WildChat (production conversations, no labels), IteraTeR has **human-annotated intention labels** on every revision pair. That gives us a real denominator and lets us compute precision/recall/F1 against human ground truth — not against SIL's own judgment.

## Label mapping

IteraTeR labels each `(before_sent, after_sent)` revision with one of five intentions. For SIL's binary corruption-vs-clean evaluation we map them as:

| IteraTeR intent | SIL binary | Reasoning |
|---|---|---|
| `meaning-changed` | **corruption** (positive) | Edit changed the literal meaning — exactly what SIL is designed to detect. |
| `fluency` | **clean** (negative) | Typo / grammar fix; meaning preserved. |
| `coherence` | **clean** (negative) | Reordering, transition smoothing; meaning preserved. |
| `clarity` | **ambiguous** | Reworded for understandability; *might* shift pragmatic intent. Reported separately. |
| `style` | **ambiguous** | Formal↔casual, voice changes; *might* shift register but not literal meaning. Reported separately. |

The binary metrics exclude `ambiguous` so we're not penalizing SIL for disagreeing on cases where humans themselves would disagree.

## Pipeline

```
fetch_iterater.py   → iterater_sample.jsonl       # Stratified across all 5 intents
score_iterater.py   → iterater_scored.jsonl       # POST each pair to SIL HTTP API
analyze_iterater.py → iterater_report.md          # Confusion matrix, P/R/F1 + bootstrap CIs, Cohen's κ, stratified
```

## Reproduce

```bash
# 1. Sample (stratified across 5 intent labels, ~100 per intent)
python3 benchmark/iterater/fetch_iterater.py --target-n 500

# 2. Start the SIL HTTP API
npx tsx src/api/server.ts > /tmp/sil-server.log 2>&1 &
sleep 5
curl -s http://localhost:8787/healthz

# 3. Score (~30 min, ~$0.30 on Haiku 4.5)
python3 benchmark/iterater/score_iterater.py \
    --in benchmark/iterater/data/iterater_sample.jsonl \
    --out benchmark/iterater/data/iterater_scored.jsonl \
    --concurrency 4

# 4. Analyze
python3 benchmark/iterater/analyze_iterater.py
```

## Reported metrics

1. **Binary confusion matrix** on the corruption-vs-clean task (ambiguous excluded)
2. **Precision, recall, F1** with bootstrap 95% CIs (n=1,000 resamples)
3. **Cohen's κ** between SIL and IteraTeR human labels (binary)
4. **Per-intent stratification**: SIL flag rate on each IteraTeR intent (meaning-changed / fluency / coherence / clarity / style)
5. **Per-ICOR-category breakdown** on `meaning-changed` examples: which ICOR categories fire most on the gold positives?

## Class distribution caveat

The full IteraTeR corpus is skewed (~80% fluency/clarity edits, ~5-15% meaning-changed). Our fetcher **stratifies** across all five intents by default (~100 per intent at N=500) so each metric has enough support per category. For the eventual scaled run we may want to either match the natural distribution (for "in the wild" framing) or keep stratified (for per-category power).

## Schema

`iterater_sample.jsonl`:
```json
{
  "id": "iter_<doc_id>_<rev_depth>_<i>",
  "doc_id": "arXiv paper id",
  "revision_depth": 1,
  "original": "before_sent",
  "suggested": "after_sent",
  "gold_intent": "meaning-changed" | "fluency" | "coherence" | "clarity" | "style",
  "gold_binary": "corruption" | "clean" | "ambiguous",
  "lang": "en"
}
```

`iterater_scored.jsonl`:
```json
{
  "id": "...",
  "doc_id": "...",
  "gold_intent": "...",
  "gold_binary": "...",
  "overall_risk": 0.85,
  "action": "block",
  "top_category": "scope_error",
  "top_prob": 0.7,
  "categoryScores": [...],
  "latency_ms": 2700,
  "scored_at": "2026-05-17T..."
}
```

## License

IteraTeR: Apache-2.0 (Du et al., 2022). Citable: *"Understanding Iterative Revision from Human-Written Text"*, ACL 2022.
