# ruflo-sil

Detects when AI rewrites silently change what you meant.

I texted a friend "I can take care of it." Autocorrect changed it to "I can't take care of it." She believed the opposite of what I meant for 47 minutes. This repo is the detector I built so that doesn't happen at AI scale.

Every AI writing tool has this failure mode. Smart Compose, Grammarly, autocorrect, every "improve this" button. Nothing catches it.

## What it does

SIL takes the original text you wrote and the AI's suggested rewrite, and returns a risk score plus which of 12 corruption categories fired.

The 12 categories:

- `polarity_negation` (I can / I can't)
- `polarity_antonym` (approve / reject)
- `modal_shift` (might / must)
- `commitment_distortion` (I'll try / I will)
- `quantifier_shift` (some / all)
- `temporal_shift` (soon / now)
- `subject_object_swap` (X said Y / Y said X)
- `scope_error` (negation scope mismatch)
- `tone_shift` (warm / cold)
- `hedging_shift` (maybe / definitely)
- `identity_corruption` (Ayaan / Susan)
- `intent_drift` (cumulative drift across multi-hop pipelines)

Plus one negative class, `true_paraphrase`, for rewrites that preserve intent.

## Results

| Eval | N | F1 | Cohen's κ |
|---|---|---|---|
| ICOR-Bench (in-distribution synthetic) | 1,460 | 93.9% | n/a |
| IteraTeR (out-of-distribution, human-labeled) | 1,572 | 67.6% | 0.453 |

The 26-point gap is the honest number. SIL catches 75% of real meaning-changing edits and correctly passes 92% of fluency fixes, but over-flags 56% of clean sentence reorderings. The NLI cross-encoder fires on lexical change regardless of meaning, and the `intent_drift` category dominates as a catch-all on naturalistic data. Both are open work, documented in the paper.

Reports: [benchmark/data/BENCH_REPORT.md](benchmark/data/BENCH_REPORT.md), [benchmark/iterater/data/iterater_report.md](benchmark/iterater/data/iterater_report.md). Paper: [paper/draft_v1.md](paper/draft_v1.md).

## Honest scope

SIL works. It is not done. We have not solved intent corruption. We named one slice of it and shipped a working detector for that slice. The 26-point gap above is real and we made it the headline of the paper instead of hiding it.

Five publishable papers worth of work sit in the gaps: taxonomy saturation, paraphrase-aware NLI reweighting, multi-hop cascade dynamics, user studies, multilingual extension. The detector is an audit layer, not a guardrail. Don't deploy it as the sole arbiter of correctness in any high-stakes setting.

For the full version (what's real, what's overhyped including by us, what we'd say if we were peer-reviewing this ourselves) read [CONTRIBUTING.md](CONTRIBUTING.md#what-this-project-is-and-isnt). If you want to help close the gap, the same file tells you exactly where.

## Quick start

```bash
git clone https://github.com/KrishnaShettyDev/ruflo-sil.git
cd ruflo-sil
npm install
```

Required env vars (free tier of both works):

- `HF_API_KEY` for the NLI and embedding detectors via Hugging Face Inference Providers
- `OPENROUTER_API_KEY` for the LLM judge via OpenRouter

### Programmatic

```ts
import { SIL } from "./src/core/sil.js";

const sil = SIL.hosted({
  hfApiKey: process.env.HF_API_KEY!,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  enableJudge: true,
});

const r = await sil.score({
  original: "I can take care of it",
  suggested: "I can't take care of it",
  surface: "chat",
});
console.log(r.action, r.overallRisk);
// → "block" 0.999
```

### HTTP API

```bash
npx tsx src/api/server.ts
# Server listening at http://127.0.0.1:8787

curl -X POST http://localhost:8787/v1/score \
  -H "Content-Type: application/json" \
  -d '{"original":"I can take care of it","suggested":"I cant take care of it","surface":"chat","parallelTrajectories":3}'
```

### MCP server

Six tools (`sil_score`, `sil_score_batch`, `sil_score_pipeline`, `sil_correct`, `sil_get_user_profile`, `sil_update_user_sample`). Wire into Claude Code or Cursor:

```bash
claude mcp add sil -- npx tsx /absolute/path/to/ruflo-sil/src/mcp/server.ts
```

## Architecture

Three trajectories run in parallel, then a per-surface aggregator combines them into a single risk score and an action (pass / warn / block).

- **T1 rules**: polarity, modal, commitment, quantifier, temporal, hedging, subject swap. About 5 ms total. No API calls.
- **T2 NLI**: T1 plus a DeBERTa-v3-large MNLI cross-encoder via Hugging Face. About 200 ms.
- **T3 deep**: T2 plus BGE-M3 embeddings and a Claude Haiku 4.5 LLM judge via OpenRouter. About 2 s.

Thresholds vary by surface. Email and document edits block at lower risk than chat or autocomplete suggestions.

Detector code in `src/detectors/`, aggregator in `src/scorers/aggregator.ts`, surface thresholds in `src/types/index.ts`.

## Reproducing the benchmarks

ICOR-Bench v2 (in-distribution synthetic, N=1,460):

```bash
export HF_API_KEY=hf_...
export OPENROUTER_API_KEY=sk-or-...
npx tsx benchmark/scripts/run-bench.ts --data benchmark/data/seed_v2.jsonl
```

About 75 minutes wall time. About $0.88 of OpenRouter credit at Haiku 4.5 rates. The `--cache .cache/judge.json` flag memoizes judge responses so subsequent threshold or trajectory ablations are nearly free.

IteraTeR human-labeled validation (out-of-distribution, N=1,572):

```bash
python3 benchmark/iterater/fetch_iterater.py --target-n 2000
npx tsx src/api/server.ts &
python3 benchmark/iterater/score_iterater.py \
  --in benchmark/iterater/data/iterater_sample.jsonl \
  --out benchmark/iterater/data/iterater_scored.jsonl
python3 benchmark/iterater/analyze_iterater.py
```

About 27 minutes wall time. About $0.94 of OpenRouter credit.

## What it's not for

- **Prompt/response evaluation** (ChatGPT-style "explain X" with a 500-word answer). SIL overfires on these because its design surface is paraphrase-class rewrites. The paper has a full section on why this is a methodology error.
- **Real-time keystroke filtering**. T3 latency is too high. Use T2-only or T1-only for tight latency budgets.
- **Non-English text**. All evaluation so far is English.

## What's in the repo

```
src/
  core/sil.ts              entry point: SIL.local() / SIL.hosted()
  detectors/               10 detector modules
  scorers/                 aggregator, cascade analyzer, intent-preserving corrector
  api/server.ts            HTTP API
  mcp/server.ts            MCP server
  hooks/pre-edit.ts        Claude Code pre-edit hook

benchmark/
  scripts/run-bench.ts     main bench runner
  data/seed_v2.jsonl       ICOR-Bench v2 (N=1,460)
  data/BENCH_REPORT.md     bench report
  hf_extract/              dataset extraction (WANLI, PAWS, ParaDetox, Anthropic)
  iterater/                IteraTeR evaluation pipeline
  wildchat/                WildChat measurement (abandoned, see paper §6.6)

paper/
  draft_v1.md              working paper draft

docs/
  PAPER.md                 original planning doc

examples/
  demo.ts                  local-mocks demo, no API keys
  deployment-audit.ts      4-hop cascade corruption demo
```

## Citation

```bibtex
@misc{ruflosil2026,
  title  = {{ICOR}: An Intent-Corruption Taxonomy, Benchmark, and Detection System for {AI}-Mediated Writing},
  author = {Krishna Shetty},
  year   = {2026},
  url    = {https://github.com/KrishnaShettyDev/ruflo-sil},
}
```

## Acknowledgment

This project began with a typo in a WhatsApp message to a friend named Ruchitha, who let me use our conversation as Figure 1 of the paper.

## License

MIT for code. CC-BY-SA-4.0 for data. The share-alike on data reflects the upstream chain (ConceptNet, WikiAtomicEdits, IteraTeR) that future extensions will pull from.
