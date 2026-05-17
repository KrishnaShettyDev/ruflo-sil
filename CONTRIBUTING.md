# Contributing to ruflo-sil

ruflo-sil is the Semantic Intent Layer: a TypeScript detector that catches when AI rewrites silently change what you meant. It ships with a 12-category taxonomy (ICOR), a synthetic bench, and an IteraTeR out-of-distribution eval.

Contributions matter here in a way they don't matter on most projects. The field of intent-corruption detection doesn't really exist yet. What lands in this repo over the next few months shapes what gets accepted as the standard. If you do serious work, your name goes on the next paper.

This is research code that works. It is not polished product code. We ship fast, things break, numbers shift. That's the deal. If you want stability, wait for v1.

## Before you contribute

Read the paper. Without context on Intent Corruption and the 12-category ICOR taxonomy, contributions will miss the point. Start with [paper/draft_v1.md](paper/draft_v1.md) or the PDF in [paper/intent_corruption_paper_plutaslab.pdf](paper/intent_corruption_paper_plutaslab.pdf). The short version is in [docs/PAPER.md](docs/PAPER.md).

Read the [README](README.md). If you don't know what SIL does end-to-end, you'll waste your time and ours.

Look at open issues. The label system (described below) tells you what's actually useful right now versus what's exploratory.

## What we need help with

### HIGH priority (directly improves the next paper)

- **Synthetic data generation for the 6 under-sampled ICOR categories.** Specifically: `polarity_antonym`, `modal_shift`, `quantifier_shift`, `temporal_shift`, `hedging_shift`, `identity_corruption`. The lexicons are documented in the paper. We need scripts that generate 100-200 examples per category using WordNet antonyms, the Lassiter modal scale, Horn quantifier scales, TIMEX3 expressions, Hyland hedge lists, and US/UK Census name lists.
- **Manual audits of IteraTeR misclassifications.** We have a 30-FN, 30-FP audit script ready at `benchmark/iterater/data/audit_samples.jsonl`. Contributors who complete the audit get cited.
- **Multilingual extension.** PAWS-X and multilingual-NLI corpora exist. Someone needs to wire them in.
- **Paraphrase-aware NLI reweighting.** The 26-point gap between ICOR-Bench and IteraTeR is mostly NLI overfiring on rewrites. An architectural fix here would change the trajectory of the next paper.

### MEDIUM priority (improves the system, not paper-critical)

- Additional deployment surfaces: VS Code extension, browser extension, Chrome MV3 plugin.
- Performance optimization. T2 latency under 200ms is the target. Caching layer improvements welcome.
- Better documentation, more examples in `docs/examples/`.
- Test coverage gaps.

### LOW priority (exploration)

- Cross-judge ablation. Swap Claude Haiku for GPT-5-mini, Gemini Flash, or others and report deltas.
- Cascade benchmark for `intent_drift` across multi-hop agent pipelines.
- User study infrastructure: Prolific integration, A/B testing scaffolding.

### Not accepting right now

- Cosmetic refactors that don't change behavior.
- Rewrites of working code into a different style.
- Adding emojis to the README or similar polish PRs.
- Anything that breaks reproducibility of the published numbers.

## Workflow

1. Fork the repo.
2. Create a branch named `feat/short-description` or `fix/short-description`.
3. Make the change. Run the test suite with `npm test`. If your change touches detectors, run the smoke bench with `npm run bench:smoke`.
4. Open a PR using the template. Tag the maintainer if it's urgent.
5. Maintainer review windows: 7 days for HIGH priority, 14 days for MEDIUM, 30 days for LOW.

## Development setup

Prerequisites:

- Node 20+
- Python 3.11+
- `HF_API_KEY` and `OPENROUTER_API_KEY` (free tier of both works)

Install and run:

```bash
npm install
npm test
npm run bench:smoke      # quick sanity check
npm run bench            # full bench, ~$0.88 in OpenRouter credit, ~76 min
npm run eval:iterater    # IteraTeR eval, ~$0.94, ~27 min
```

## Code style

- TypeScript strict mode is on.
- The existing prettier config auto-formats on save in most editors. Don't fight it.
- Tests live next to the file they test (`file.ts` next to `file.test.ts`).
- Detectors live in `src/detectors/`. Each category gets its own folder.
- No new dependencies without a good reason. Bundle size matters for the browser plugin.

## Commit messages

Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `bench:`. Keep the first line under 72 characters. Body explains why, not what.

## Labels

The issue tracker uses these labels. They map to what's described above.

- `priority/high` — paper-critical work
- `priority/medium` — system improvement
- `priority/low` — exploration
- `bug` — something broken
- `enhancement` — new feature or capability
- `research` — methodological question
- `documentation` — docs only
- `good-first-issue` — for new contributors
- `help-wanted` — actively looking for someone to take this
- `paper-2` — relates to the architectural-fix follow-up paper
- `paper-3` — relates to the cascade-dynamics follow-up paper
- `wontfix` — explicitly declined, with reason
- `duplicate` — see linked issue

## License for your contributions

By submitting a PR, you agree your contribution is licensed under MIT (for code) or CC-BY-SA-4.0 (for data and benchmark assets).

We don't require a CLA. Don't be a corporation pretending to be an individual.

## Citation policy

Significant contributors are credited in the paper's acknowledgments. Anyone who lands a HIGH priority contribution is offered co-authorship on the relevant follow-up paper. We track contributions in [CONTRIBUTORS.md](CONTRIBUTORS.md).

## Getting help

- Open a GitHub Discussion for design or research questions.
- Open an issue for bugs or specific feature requests.
- Tag the maintainer in the PR or issue if it's urgent.
