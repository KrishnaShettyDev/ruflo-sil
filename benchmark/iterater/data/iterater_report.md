# IteraTeR × SIL Evaluation Report

**N scored:** 1572
**Source:** wanyu/IteraTeR_human_sent (Du et al., ACL 2022, Apache-2.0)
**Evaluator:** SIL hosted (HF DeBERTa NLI + BGE embeddings + OpenRouter Claude Haiku 4.5)
**Surface:** document

**Label mapping:**
- `meaning-changed` → corruption (positive class)
- `fluency`, `coherence` → clean (negative class)
- `clarity`, `style` → ambiguous (reported separately; excluded from binary)

## 1. Binary task — corruption vs clean (ambiguous excluded)

**N in binary task:** 1072 (corruption=400, clean=672)

### Confusion matrix

```
                 predicted
                corruption    clean
gold corruption       299        101
gold clean            185        487
```

### Metrics

| metric | point | 95% CI |
|---|---|---|
| precision    | 0.618 | [0.575, 0.664] |
| recall       | 0.748 | [0.704, 0.786] |
| F1           | 0.676 | [0.640, 0.712] |
| Cohen's κ    | 0.453 | [0.403, 0.506] |

## 2. SIL behavior stratified by IteraTeR intent

For each human-labeled intent, what fraction did SIL flag as corruption?

| intent | n | flag rate (block+warn) | n_block | n_warn | n_pass |
|---|---|---|---|---|---|
| meaning-changed | 400 | 74.8% | 281 | 18 | 101 |
| fluency | 400 | 8.0% | 31 | 1 | 368 |
| coherence | 272 | 56.2% | 139 | 14 | 119 |
| clarity | 400 | 41.8% | 144 | 23 | 233 |
| style | 100 | 37.0% | 33 | 4 | 63 |

## 3. Which ICOR categories fire on meaning-changed examples?

On the 400 `meaning-changed` examples, 299 were flagged. Top categories:

| ICOR category | count | % of meaning-changed flags |
|---|---|---|
| intent_drift | 206 | 68.9% |
| polarity_negation | 25 | 8.4% |
| scope_error | 22 | 7.4% |
| identity_corruption | 20 | 6.7% |
| modal_shift | 11 | 3.7% |
| tone_shift | 6 | 2.0% |
| commitment_distortion | 4 | 1.3% |
| subject_object_swap | 3 | 1.0% |
| quantifier_shift | 1 | 0.3% |
| polarity_antonym | 1 | 0.3% |

## 4. Ambiguous slice (clarity / style edits)

These IteraTeR intent labels modify surface form without explicitly changing literal meaning, but may shift pragmatic intent (the kind of edits the SIL taxonomy argues count as corruption). Reported separately rather than binned into the binary task.

- **clarity** (n=400): SIL flag rate = 41.8% (block=144, warn=23, pass=233)
- **style** (n=100): SIL flag rate = 37.0% (block=33, warn=4, pass=63)
