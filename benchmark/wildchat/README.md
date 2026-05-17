# WildChat × SIL Measurement Study

A measurement of intent-corruption rates across real ChatGPT conversations from the WildChat-1M corpus. The goal is a publishable population-level finding: **how prevalent is intent corruption in real AI-mediated writing, stratified by model and task?**

## What this measures

Each (user_message, assistant_message) pair from WildChat is passed through SIL with `original=user_message`, `suggested=assistant_message`, `surface=chat`. SIL outputs:
- An overall risk score in [0, 1]
- An action: `pass`, `warn`, or `block`
- Per-ICOR-category probabilities

We aggregate corruption rates (= rate of `action != pass`) across the sample and stratify by model, task type, user-turn length, and the dominant ICOR category.

## Files

```
fetch_wildchat.py     # Stratified streaming sampler over allenai/WildChat-1M
score_wildchat.py     # Async HTTP client → SIL API; resumable
analyze_wildchat.py   # Bootstrap CIs, stratified tables, Markdown report
plot_wildchat.py      # PDF figures for the paper
data/                 # JSONL inputs/outputs, CSV tables, PDF figures, MD report
```

## How to reproduce

### Prereqs

```bash
# Env vars (read from .env)
export HF_API_KEY=hf_...                  # Hugging Face read token
export OPENROUTER_API_KEY=sk-or-v1-...    # OpenRouter API key

# Python deps
pip3 install datasets langdetect aiohttp pandas scipy matplotlib
```

### Run the pilot (N=1,000, ~30-45 min, ~$0.60)

```bash
# 1. Sample 1,000 conversations
python3 benchmark/wildchat/fetch_wildchat.py --target-n 1000

# 2. Start the SIL HTTP server in background
npx tsx src/api/server.ts > /tmp/sil-server.log 2>&1 &
sleep 5
curl -s http://localhost:8787/healthz   # confirm "ok"

# 3. Score the sample
python3 benchmark/wildchat/score_wildchat.py \
    --in benchmark/wildchat/data/wildchat_sample.jsonl \
    --out benchmark/wildchat/data/wildchat_scored.jsonl \
    --concurrency 4

# 4. Analyze and plot
python3 benchmark/wildchat/analyze_wildchat.py
python3 benchmark/wildchat/plot_wildchat.py
```

### Scale to full study (N=50,000, ~24-30 hours, ~$30)

After validating the methodology on the pilot:

```bash
caffeinate -i python3 benchmark/wildchat/fetch_wildchat.py --target-n 50000
caffeinate -i python3 benchmark/wildchat/score_wildchat.py \
    --in benchmark/wildchat/data/wildchat_sample.jsonl \
    --out benchmark/wildchat/data/wildchat_scored.jsonl \
    --concurrency 4
```

The score step is resumable — a crash at row 30,000 picks up at row 30,001 on next launch (it reads existing output ids and skips them).

## Schema

`wildchat_sample.jsonl`:
```json
{
  "id": "wc_<conv_hash>_<turn_idx>",
  "conversation_id": "...",
  "turn_idx": 0,
  "model": "gpt-4" | "gpt-4-turbo" | "gpt-4o" | "gpt-3.5-turbo" | ...,
  "task_type": "summarize" | "rewrite" | "code" | "translate" | "qa" | "other",
  "length_bucket": "short" | "medium" | "long",
  "user_message": "...",
  "assistant_message": "...",
  "lang": "en"
}
```

`wildchat_scored.jsonl`:
```json
{
  "id": "...",
  "conversation_id": "...",
  "turn_idx": 0,
  "model": "...",
  "task_type": "...",
  "length_bucket": "...",
  "overall_risk": 0.42,
  "action": "warn",
  "top_category": "tone_shift",
  "top_prob": 0.65,
  "categoryScores": [{"category": "...", "probability": ..., "severity": ...}, ...],
  "latency_ms": 2800
}
```

## Costs

| Scale | Wall time | OpenRouter cost | Notes |
|---|---|---|---|
| Pilot (N=1,000) | ~30-45 min | ~$0.60 | Validates methodology |
| Full (N=50,000) | ~24-30 hours | ~$30 | Resumable across crashes |

Both estimates assume Claude Haiku 4.5 via OpenRouter, parallelTrajectories=3, concurrency=4.

## Known limitations

1. **Weakly supervised.** SIL labels are not human-verified. Reported corruption rates reflect SIL's judgment, which has known precision issues on natural paraphrases (see `benchmark/data/BENCH_REPORT.md` §5.1). For publication, a 200-example human-validation subset is required.
2. **English only.** Non-English conversations are filtered out via `langdetect`.
3. **Single-turn evaluation.** Multi-hop cascade drift is measured separately (see `examples/deployment-audit.ts` and the planned Gap 5 cascade study).
4. **WildChat is ChatGPT-only.** Model stratification is across GPT variants (3.5, 4, 4-turbo, 4o). For cross-provider comparison (Claude, Gemini, Llama), re-prompt a sample against multiple providers (separate experiment).
5. **No demographic stratification.** WildChat lacks user-level demographic metadata. Identity-corruption analysis requires inferring sensitive attributes from text, which we don't do.

## License

- WildChat-1M: CC-BY-4.0 (Allen Institute for AI)
- This analysis: same license as ruflo-sil

When publishing: cite Zhao et al., "WildChat: 1M ChatGPT Interaction Logs in the Wild" (ICLR 2024).
