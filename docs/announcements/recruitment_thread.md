# Recruitment thread (draft, not yet posted)

Land this **the day after** the honest-scope thread, not the same day. Both threads compound: thread 1 builds credibility, thread 2 converts the people thread 1 attracted.

## Before posting checklist

- [ ] The honest-scope thread has been posted (Tuesday or Wednesday ideal).
- [ ] Replace `[HCI-HANDLE-1]`, `[HCI-HANDLE-2]`, `[HCI-HANDLE-3]` in tweet 4 with real, current X/Twitter handles. Suggested names worth checking: Lilly Irani (UCSD), Wendy Mackay (Inria), Mary Czerwinski (MSR), Niloufar Salehi (Berkeley), Michael Bernstein (Stanford). Verify each handle is active and recently posting before tagging. If you can't confirm 2-3 active handles, drop the tags entirely. The thread works without them.
- [ ] Replace the CONTRIBUTING.md link in tweet 6 with the live URL after the commit is pushed.
- [ ] Confirm the audit_samples.jsonl file is live in the repo (already shipped in this commit).
- [ ] Confirm the three seed issues are open (Priority 1, Priority 4 polarity_antonym, Priority 4 hedging_shift, Priority 6).

## Thread

**Tweet 1 / 7**

We published ruflo-sil last week. Here's a thread on what comes after, because most open-source "roadmaps" are vague and most research-project roadmaps don't tell you what's actually possible.

If you're a researcher looking for real work to do on AI-mediated writing, read on.

---

**Tweet 2 / 7**

Paper two: close the 26-point F1 gap between synthetic and naturalistic data. We diagnosed two failure modes (NLI over-firing on rewrites, `intent_drift` catch-all dominance). We didn't fix them.

We wrote the diagnostic. Someone needs to write the fix.

Co-authorship offered. 2 to 4 months for someone with ML systems experience.

---

**Tweet 3 / 7**

Paper three: multi-hop cascade dynamics. Intent corruption compounds across drafter -> polisher -> tone editor -> review pipelines. Nobody has measured how the drift grows.

Linear in hops? Exponential? Saturating? Different for homogeneous vs heterogeneous pipelines?

Wide open. Co-authorship. 1 to 2 months.

---

**Tweet 4 / 7**

Paper four: user study. We claim SIL helps users. We haven't tested it. 80 to 120 participants on Prolific, within-subjects, blind forced-choice between raw AI edit and SIL-corrected version.

For an HCI graduate student looking for a publishable side project: this is it. Co-authorship offered.

[HCI-HANDLE-1] [HCI-HANDLE-2] [HCI-HANDLE-3] in case this lands with anyone in your networks who works on AI-mediated writing.

---

**Tweet 5 / 7**

Two entry points if a multi-month paper isn't your speed right now:

1. Synthetic data for six under-sampled ICOR categories. Recipes documented in the paper. 1 to 2 weeks.

2. Hand-label 60 IteraTeR cases (30 FN, 30 FP) to tell us how much of the 26-point gap is annotation noise vs real error. One weekend. No coding. Native English speaker preferred. File is in the repo, ready to go.

---

**Tweet 6 / 7**

Full roadmap with difficulty estimates, skill requirements, where-to-start steps, and what-you-get for each priority:

https://github.com/KrishnaShettyDev/ruflo-sil/blob/main/CONTRIBUTING.md#what-to-work-on-next-the-real-roadmap

Eight priorities. Ranked by importance, not by ease.

---

**Tweet 7 / 7**

Co-authorship on the follow-up papers is on the table for anyone who lands serious work in any of the above.

That's the deal. No CLA, no exclusivity, no bullshit.
