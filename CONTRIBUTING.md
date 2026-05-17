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

## What To Work On Next: The Real Roadmap

We're going to spell out what comes after this paper, because most "roadmap" sections in open source are vague. If you want to do real research work that ends up in a publication, here is what's actually needed. We've ranked these by importance to the long-term arc of the field, not by how easy they are. Some of the most important work is also the hardest. We're being honest about that so you don't waste your time picking the wrong problem.

### Priority 1: The architectural fix paper (paper two)

**What it is:** SIL drops from 94 percent F1 on synthetic data to 68 percent F1 on naturalistic human-labeled revisions. We diagnosed two failure modes. NLI overfires on sentence reordering. The catch-all `intent_drift` category absorbs 69 percent of true positives instead of routing to specific categories. The architectural fix is to reweight NLI's contradiction signal when the LLM judge disagrees, and to retrain category detectors on naturalistic revision corpora instead of synthetic perturbations. Whoever does this and demonstrates the gap closing from 26 points to under 15 has the next major paper in this line.

**Why we haven't done it yet:** Time and focus. We shipped the diagnostic paper first so the field has a name. The fix is the obvious next move but it requires either rebuilding the aggregator with a learned reweighting scheme or fine-tuning a new NLI model on rewrite-class data. Both are real engineering projects, not weekend hacks.

**What "done" looks like:** A modified SIL that closes at least 8 of the 26 F1 points on IteraTeR while preserving recall on ICOR-Bench. A paper documenting the architecture, the training approach, and the new evaluation gradient.

**Difficulty and time:** Two to four months of focused work for someone with ML systems experience. Could be faster if you already have a fine-tuning pipeline running.

**Skills required:** Strong NLI background, comfortable with HuggingFace fine-tuning, ideally some background in pragmatics or computational linguistics. Not a beginner project.

**What you get:** Co-authorship on the follow-up paper. This is the highest-leverage contribution you can make to this project right now.

**Where to start:** Read §8 of the paper, the failure-mode diagnosis section. Run `npm run eval:iterater` to reproduce the baseline. Open a research-question issue describing your proposed approach before you write code.

### Priority 2: Multi-hop cascade dynamics (paper three)

**What it is:** Intent corruption compounds across multi-step AI pipelines. A user's text passes through a drafter, a polisher, a tone editor, a legal-review step before reaching the recipient. Each hop introduces some probability of drift. Nobody has measured how this drift grows. Linear in the number of hops? Exponential? Saturating? Different for homogeneous (all-Claude) versus heterogeneous (Claude-then-GPT-then-Gemini) pipelines? This is wide open and the answers would matter for every production agent system being built right now.

**Why we haven't done it yet:** We have the anecdotal version in `examples/deployment-audit.ts` but not the controlled experiment. Running 200 seed prompts through 4-to-10-hop pipelines across varied compositions takes real compute and careful experimental design.

**What "done" looks like:** A controlled cascade benchmark, 200 seed prompts minimum, varied across pipeline length (4, 6, 8, 10 hops) and composition (homogeneous, heterogeneous, adversarial-tone hop in the middle). Drift measured per-category per-hop. Growth curves fit and reported with bootstrap confidence intervals. A paper that names the dynamics.

**Difficulty and time:** One to two months for someone comfortable with agent orchestration. The compute cost is manageable, estimated 50 to 100 dollars in API spend if you batch carefully.

**Skills required:** Agent orchestration (LangGraph, CrewAI, ruflo, AutoGen, pick one), basic statistics for curve fitting, comfortable running long experiments.

**What you get:** Co-authorship on the cascade paper. This is the most novel direction in the program because nobody else has framed multi-hop drift as a measurable phenomenon yet.

**Where to start:** Read `examples/deployment-audit.ts` to see the anecdotal version. Pick a pipeline framework. Open a research-question issue with your proposed experimental design.

### Priority 3: User study and behavioral validation (paper four, UIST/CHI track)

**What it is:** We claim SIL helps users avoid intent corruption. We have not tested whether this is true. A within-subjects study on Prolific with 80 to 120 participants, asking which version of an AI-edited text preserves intent better (the raw AI edit versus the SIL-corrected version), would tell us whether the system actually helps humans or whether it's all theoretical. Without this, the paper is a system paper. With this, it's a system-plus-impact paper.

**Why we haven't done it yet:** Money and time. A 60-minute Prolific study at 12 dollars per participant runs around 1,800 dollars after fees. We don't have that budget. Also requires careful stimulus design, pre-registration of hypotheses, and ethics review.

**What "done" looks like:** A pre-registered study with 80 to 120 participants, stimuli stratified across the 12 ICOR categories, blind forced-choice between AI-suggested and SIL-corrected versions, results with 95 percent confidence intervals. A paper for UIST 2027 or CHI 2028.

**Difficulty and time:** Three months including IRB-equivalent ethics review, stimulus prep, recruitment, analysis, writeup. Most of the time is non-technical.

**Skills required:** HCI research background, comfortable with Prolific or similar platforms, pre-registration discipline, basic statistics. Cannot be done by an ML engineer alone. Needs someone with human-subjects research experience.

**What you get:** Co-authorship on the user-study paper. Strong line on an HCI researcher's resume. If you're a graduate student in HCI looking for a publishable side project that connects to current AI safety discourse, this is a great fit.

**Where to start:** Email us before doing anything. We want to talk through funding (we can possibly cover Prolific costs ourselves if the proposal is strong) and ensure the study design matches the bench correctly.

### Priority 4: Synthetic generation for the under-sampled six categories

**What it is:** Six categories in ICOR-Bench (`polarity_antonym`, `modal_shift`, `quantifier_shift`, `temporal_shift`, `hedging_shift`, `identity_corruption`) have only four or five examples each. The reported 100 percent accuracy on these is statistically meaningless. We have the lexicons documented in the paper. Someone needs to write the synthetic generation scripts.

**Why we haven't done it yet:** We had to choose between filling the bench gaps and shipping the IteraTeR validation. We shipped IteraTeR because human ground truth was more important. The synthetic generation is straightforward but takes maybe a week of careful work.

**What "done" looks like:** Generation scripts for each category producing 100 to 200 examples. Hand-validation of 30 random samples per category to confirm quality. Updated ICOR-Bench with all 12 categories at N greater than or equal to 100. Updated bench numbers in the paper if they shift.

**Difficulty and time:** One to two weeks part-time. The recipes are written in §10 of the paper. WordNet antonyms for `polarity_antonym`. Lassiter modal scale for `modal_shift`. Horn scales for `quantifier_shift`. TIMEX3 expressions for `temporal_shift`. Hyland hedge lists for `hedging_shift`. US/UK Census plus WikiData name lists for `identity_corruption`.

**Skills required:** Python, comfort with NLTK or spaCy, attention to detail. This is a good first contribution for someone who wants to learn the codebase.

**What you get:** Acknowledgment in the paper, label of "Data and benchmark contributor" in CONTRIBUTORS.md, and a clear path to bigger contributions afterward.

**Where to start:** Read §10 of the paper for the recipes. Pick one category. Open an issue describing your approach and any questions about quality criteria.

### Priority 5: Multilingual extension

**What it is:** All experiments are English-only. The identity-corruption category is particularly relevant in non-English contexts. The "I Am Not a Typo" findings are explicitly about names of South Asian, African, Welsh, and Scottish origin getting mangled by autocorrect. PAWS-X exists (6 languages), multilingual NLI corpora exist, ConceptNet has antonym pairs across 80 languages. Someone needs to wire these in and measure SIL's behavior cross-linguistically.

**Why we haven't done it yet:** Resource constraint. A proper multilingual study needs native speakers for validation in each language. We only have English coverage natively.

**What "done" looks like:** SIL evaluated on at least three languages beyond English (Spanish, German, Hindi as a strong candidate set). Per-language benchmark constructed from the multilingual corpora. Per-language performance reported. Identity-corruption category specifically tested on names from the relevant language regions.

**Difficulty and time:** Two to three months. Most of the time is data assembly and validation, not code.

**Skills required:** Multilingual NLP experience, at least one language other than English fluently, ideally a network of native speakers willing to help validate.

**What you get:** Co-authorship on the multilingual paper, which is a separate publication from the architectural-fix paper. Good fit for a researcher with NLP experience in a non-English language community.

**Where to start:** Read the §10 limitations discussion of multilingual extension. Open a research-question issue with your proposed language coverage and validation approach.

### Priority 6: Manual audit of IteraTeR misclassifications

**What it is:** We have 30 false negatives and 30 false positives sitting in `benchmark/iterater/data/audit_samples.jsonl` waiting to be hand-labeled. The question we want answered: of the cases where SIL disagrees with IteraTeR human annotators, how many are genuine model errors versus IteraTeR annotation noise? This audit determines whether SIL's real ceiling is 68 percent F1 or somewhere closer to 75 percent.

**Why we haven't done it yet:** Labeling 60 examples carefully takes 4-6 hours and we wanted an independent set of eyes on it, not the author's own labels.

**What "done" looks like:** Each of the 60 examples labeled with a verdict (SIL right, SIL wrong, ambiguous), notes explaining the verdict, and a summary statistic of how much of the 26-point gap is annotation noise versus real error.

**Difficulty and time:** One weekend if you can read English carefully and reason about pragmatic meaning. Native English speaker preferred. Some linguistics background helps.

**Skills required:** Native or near-native English. Patience. Willingness to reason about subtle meaning shifts. No coding required.

**What you get:** Acknowledgment in the paper. Citation if the audit substantially changes the reported numbers. A surprisingly good window into how research actually works.

**Where to start:** Open `benchmark/iterater/data/audit_samples.jsonl`. Fill in the `audit_label` and `audit_notes` fields. Open a PR when done.

### Priority 7: Cross-judge ablation

**What it is:** We use Claude Haiku 4.5 as the LLM judge in T3. Whether SIL's performance generalizes when we swap in GPT-5-mini, Gemini Flash, Llama 3.3 or DeepSeek-V3 as the judge is unknown. A cross-judge ablation would tell us whether the system is bound to a specific model or whether the architecture survives judge substitution.

**Why we haven't done it yet:** We had to ship the paper. The ablation is cheap (under 20 dollars in API spend across four judges) but takes wall time to run.

**What "done" looks like:** SIL evaluated on ICOR-Bench and IteraTeR with each of (Claude Haiku, GPT-5-mini, Gemini Flash, Llama 3.3 70B, DeepSeek-V3) as judge. Per-judge F1 and kappa reported. A short technical report or appendix to the next paper.

**Difficulty and time:** One to two weeks. The cache wrapper means most runs are cheap once you've done the first one. The OpenRouter API keys for the alternative judges are easy to acquire.

**Skills required:** Comfortable with the existing codebase, basic familiarity with the LLM judge interface in `src/detectors/llm-judge/`.

**What you get:** Acknowledgment, possibly inclusion as a section in paper two if results are interesting.

**Where to start:** Read `src/detectors/llm-judge/index.ts` to understand the backend abstraction. The OpenRouter integration already supports model swapping via config. Open an issue when you're ready to run.

### Priority 8: Production deployment study

**What it is:** We have not tested SIL in a real production AI writing pipeline. Someone running a customer-facing AI writing product (translation tool, email assistant, customer support agent) who wires SIL into their stack and reports flag rates, user-facing intervention impact, and false-positive cost would give the field its first real-world data.

**Why we haven't done it yet:** We don't have a production AI writing product. We're a research lab.

**What "done" looks like:** A deployment report covering at least 10,000 SIL evaluations from real production traffic. Flag rates by surface type. User-facing impact (did users accept or reject the flagged suggestions, did warnings reduce errors). Honest discussion of false-positive cost.

**Difficulty and time:** Depends entirely on what you're already operating. If you run a relevant product, this is two to four weeks of work plus your existing deployment cycle. If you're starting from scratch, this isn't realistic.

**Skills required:** You need to already be running a production AI writing product. Otherwise this isn't the right priority for you.

**What you get:** Co-authorship if the deployment data is substantive. A real-world case study cited by everyone working on this problem after you.

**Where to start:** Email us. We want to talk before you commit to this. There are specific protocols we'd want in place to make the data comparable to our benchmark numbers.

If you've read this far, you have a real picture of where this research can go. The architectural-fix paper and the cascade-dynamics paper are the two highest-leverage opportunities. The user study is the highest-impact for HCI researchers. The synthetic generation and IteraTeR audit are good entry points if you want to contribute without committing to a multi-month project. Pick one, open an issue, and let's talk before you write code. We'd rather spend an hour aligning on approach than have you spend a month on something we won't be able to merge.

We're treating this project as a multi-year arc. We expect to ship paper two within four to six months. Paper three within nine to twelve months. Paper four when someone with HCI experience picks it up. Paper five (the deployment study) is on whatever timeline a production partner makes possible. If you contribute meaningfully to any of these, your name is on the work. That's the deal.

## Before you contribute

Read the paper. Without context on Intent Corruption and the 12-category ICOR taxonomy, contributions will miss the point. Start with [paper/draft_v1.md](paper/draft_v1.md) or the PDF in [paper/intent_corruption_paper_plutaslab.pdf](paper/intent_corruption_paper_plutaslab.pdf). The short version is in [docs/PAPER.md](docs/PAPER.md).

Read the [README](README.md). If you don't know what SIL does end-to-end, you'll waste your time and ours.

Look at open issues. The label system (described below) tells you what's actually useful right now versus what's exploratory.

## What we need help with

We need help across eight specific priorities ranked by importance, from a one-weekend audit task to a multi-month architectural overhaul. Each has explicit difficulty estimates, skill requirements, and co-authorship offers where appropriate. Full breakdown in the [roadmap section above](#what-to-work-on-next-the-real-roadmap).

What we're not accepting right now: cosmetic refactors that don't change behavior, rewrites of working code into a different style, README polish PRs, and anything that breaks reproducibility of the published numbers.

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

- `priority/high`: paper-critical work
- `priority/medium`: system improvement
- `priority/low`: exploration
- `bug`: something broken
- `enhancement`: new feature or capability
- `research`: methodological question
- `documentation`: docs only
- `good-first-issue`: for new contributors
- `help-wanted`: actively looking for someone to take this
- `paper-2`: relates to the architectural-fix follow-up paper
- `paper-3`: relates to the cascade-dynamics follow-up paper
- `wontfix`: explicitly declined, with reason
- `duplicate`: see linked issue

## License for your contributions

By submitting a PR, you agree your contribution is licensed under MIT (for code) or CC-BY-SA-4.0 (for data and benchmark assets).

We don't require a CLA. Don't be a corporation pretending to be an individual.

## Citation policy

Significant contributors are credited in the paper's acknowledgments. Anyone who lands a HIGH priority contribution is offered co-authorship on the relevant follow-up paper. We track contributions in [CONTRIBUTORS.md](CONTRIBUTORS.md).

## Getting help

- Open a GitHub Discussion for design or research questions.
- Open an issue for bugs or specific feature requests.
- Tag the maintainer in the PR or issue if it's urgent.
