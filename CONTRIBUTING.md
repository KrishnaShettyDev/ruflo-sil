# Contributing to ruflo-sil

ruflo-sil is the Semantic Intent Layer: a TypeScript detector that catches when AI rewrites silently change what you meant. It ships with a 12-category taxonomy (ICOR), a synthetic bench, and an IteraTeR out-of-distribution eval.

Contributions matter here in a way they don't matter on most projects. The field of intent-corruption detection doesn't really exist yet. What lands in this repo over the next few months shapes what gets accepted as the standard. If you do serious work, your name goes on the next paper.

This is research code that works. It is not polished product code. We ship fast, things break, numbers shift. That's the deal. If you want stability, wait for v1.

## What This Project Is And Isn't

We want to be honest with anyone considering contributing. Open source attracts people who want to work on important things. Whether this project counts as that is your call, not ours. Here is the real picture.

### What's actually real about this work

We named a phenomenon that genuinely exists and didn't have a unified name in the research literature. Naming things is how fields get built. The framing contribution is modest but real.

We built a working detector. The code runs, the bench runs, the IteraTeR evaluation runs, and the numbers are reproducible for under two dollars in API credit. Most NLP papers have less reproducible infrastructure than what we shipped.

We did the harder thing most research projects skip. We tested against third-party human-labeled data and reported the honest number. F1 dropped from 94 to 68 percent. Cohen's kappa came in at 0.45, moderate agreement with humans. We didn't hide this. We made the gap the headline finding.

The taxonomy is grounded in actual linguistic theory (Horn, Searle, Hyland, Halliday, Grosz and Sidner), not stuff we invented.

### What's overhyped, including by us sometimes

We have not solved intent corruption. We named one slice of the problem, built one detector, and showed it works partially. The actual problem of AI silently changing user meaning at production scale is wide open.

The 94 percent F1 on the synthetic benchmark is in-distribution performance against weak labels we derived from upstream datasets. Without the IteraTeR validation showing 68 percent F1 against human ground truth, this would be a much thinner contribution.

The "first paper on intent corruption" framing is true in a narrow sense. There's a real chance someone at a larger lab has been working on something adjacent and hasn't published yet. There's also a real chance our terminology gets renamed by a more senior researcher when they pick it up. Most attempted-naming papers don't have their terms stick. We hope ours does. We don't know yet.

Our marketing on Instagram and elsewhere calls this "paper one of five." That's only true if we, or contributors, actually write papers two through five. If we don't, this becomes paper one of one, and most papers one of one are forgotten within two years.

### What we'd say if we were peer-reviewing this ourselves

We'd accept it with revisions to a second-tier conference (ACL Findings, EMNLP Findings, COLING) or a strong workshop. We would not accept it to ACL main track or EMNLP main track in current form. The reasons we'd flag:

The taxonomy needs a saturation study. The twelve categories are inductive, not validated against held-out in-the-wild data.

The bench is weakly supervised. The IteraTeR result is the credible number, not the 94 percent on ICOR-Bench.

Five of twelve categories have only four examples in the bench. That's a structural hole, not just future work.

There's no user study yet. The claim that detecting intent corruption helps users is theoretical.

The architectural diagnosis (intent_drift catch-all dominance, NLI overfiring on coherence) is good but unverified. We hypothesize the fix but haven't tested whether the fix actually closes the gap.

### What this means for you as a contributor

If you contribute meaningfully to fixing any of the issues above, you are doing genuine research work, not just helping a maintainer polish a side project. The paper-two opportunities (architectural fix, multi-hop cascade dynamics) are real publishable work. The paper-three opportunities (user study, multilingual extension) are real publishable work. We aren't pretending the headline paper is the finished thing. We're saying it's the seed of a research program that needs more hands to grow.

If you're looking for a polished open-source product to use in production, this isn't that yet. The detector works, but the 26-point gap means you should not deploy SIL as a sole arbiter of correctness in any high-stakes setting. It's an audit layer, not a guardrail.

If you're looking for a credentialed lab attached to a big name, we are not that. Plutas Lab is an independent research outfit based in Bangalore. The work stands on what it shows, not on where it came from. That's a feature for some contributors and a problem for others.

We'd rather you decide to contribute knowing all of this than have you find out later that the marketing oversold the work. Research moves on honest priors. So does open source.

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
