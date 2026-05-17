# WildChat × SIL Measurement Report

**N scored:** 1000
**Source:** allenai/WildChat-1M (CC-BY-4.0)
**Evaluator:** SIL hosted (HF DeBERTa NLI + BGE embeddings + OpenRouter Claude Haiku 4.5)

## Overall

**Overall corruption rate: 96.9%** (95% CI [95.8, 97.9])

- block: 902 (90.2%)
- warn:  67 (6.7%)
- pass:  31 (3.1%)


## Corruption rate by model

| model | n | corruption_rate | ci_lo | ci_hi | n_block | n_warn |
|---|---|---|---|---|---|---|
| gpt-3.5-turbo | 477 | 97.3% | 95.8% | 98.7% | 436 | 28 |
| gpt-4 | 523 | 96.6% | 94.8% | 98.1% | 466 | 39 |


## Corruption rate by task type

| task_type | n | corruption_rate | ci_lo | ci_hi | n_block | n_warn |
|---|---|---|---|---|---|---|
| summarize | 88 | 100.0% | 100.0% | 100.0% | 84 | 4 |
| qa | 266 | 98.1% | 96.2% | 99.6% | 247 | 14 |
| other | 300 | 98.0% | 96.3% | 99.3% | 277 | 17 |
| translate | 70 | 97.1% | 92.9% | 100.0% | 63 | 5 |
| code | 173 | 97.1% | 94.2% | 99.4% | 151 | 17 |
| rewrite | 103 | 87.4% | 80.6% | 93.2% | 80 | 10 |


## Corruption rate by length bucket

| length_bucket | n | corruption_rate | ci_lo | ci_hi | n_block | n_warn |
|---|---|---|---|---|---|---|
| short | 309 | 97.1% | 95.1% | 98.7% | 278 | 22 |
| long | 376 | 97.1% | 95.5% | 98.7% | 344 | 21 |
| medium | 315 | 96.5% | 94.3% | 98.4% | 280 | 24 |


## Top ICOR category on flagged conversations

| category | n_flagged | pct_of_flags |
|---|---|---|
| polarity_negation | 522 | 53.9% |
| intent_drift | 168 | 17.3% |
| modal_shift | 100 | 10.3% |
| scope_error | 46 | 4.7% |
| tone_shift | 39 | 4.0% |
| commitment_distortion | 38 | 3.9% |
| subject_object_swap | 38 | 3.9% |
| quantifier_shift | 7 | 0.7% |
| polarity_antonym | 7 | 0.7% |
| identity_corruption | 4 | 0.4% |


## Cross-model × ICOR category corruption rate

| model | commitment_distortion | identity_corruption | intent_drift | modal_shift | polarity_antonym | polarity_negation | quantifier_shift | scope_error | subject_object_swap | tone_shift |
|---|---|---|---|---|---|---|---|---|---|---|
| gpt-3.5-turbo | 3.6% | 0.8% | 19.1% | 8.8% | 0.4% | 50.7% | 0.4% | 6.7% | 3.1% | 3.6% |
| gpt-4 | 4.0% | 0.0% | 14.7% | 11.1% | 1.0% | 53.5% | 1.0% | 2.7% | 4.4% | 4.2% |


## Risk distribution by action

| action | n | mean risk | median risk | min | max |
|---|---|---|---|---|---|
| pass | 31 | 0.334 | 0.400 | 0.050 | 0.494 |
| warn | 67 | 0.723 | 0.750 | 0.510 | 0.793 |
| block | 902 | 0.960 | 1.000 | 0.800 | 1.000 |

