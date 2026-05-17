/**
 * Deployment Audit example.
 *
 * Pretend we have a customer-support agent pipeline:
 *   user_message
 *      ↓ classifier-agent  (classifies intent)
 *      ↓ drafter-agent     (drafts a reply)
 *      ↓ tone-polisher     (rewrites in brand voice)
 *      ↓ legal-reviewer    (adds disclaimers)
 *      ↓ final_reply
 *
 * SIL's CascadeAnalyzer scores each hop and the cumulative drift, then we
 * report the per-category drift pattern. This is the kind of audit that
 * teams pay for — "is your $50M agent stack silently corrupting customer
 * communications?"
 *
 * Run:
 *   npx tsx examples/deployment-audit.ts
 */

import { SIL } from "../src/core/sil.js";
import { CascadeAnalyzer } from "../src/scorers/cascade.js";

function fmtRisk(r: number): string {
  const pct = Math.round(r * 100);
  if (pct >= 75) return `\x1b[31m${pct}% BLOCK\x1b[0m`;
  if (pct >= 50) return `\x1b[33m${pct}% WARN\x1b[0m`;
  return `\x1b[32m${pct}% ok\x1b[0m`;
}

async function main() {
  const sil = SIL.local();
  const cascade = new CascadeAnalyzer(sil);

  // ---- Pipeline 1: subtle drift ----
  const subtleDrift = await cascade.analyze({
    pipelineId: "support-reply-v1",
    surface: "agent_pipeline",
    hops: [
      {
        agentId: "classifier",
        input: "i'm pretty sure my account got charged twice last week, can someone take a look?",
        output: "Customer reports a possible duplicate charge from last week; requesting review.",
      },
      {
        agentId: "drafter",
        input: "Customer reports a possible duplicate charge from last week; requesting review.",
        output: "I think we may have charged you twice last week. Let me look into it.",
      },
      {
        agentId: "tone-polisher",
        input: "I think we may have charged you twice last week. Let me look into it.",
        output: "We charged you twice last week. We will investigate.",
      },
      {
        agentId: "legal-reviewer",
        input: "We charged you twice last week. We will investigate.",
        output: "We charged you twice last week. We will issue a full refund within 5 business days.",
      },
    ],
  });

  console.log("\n========================================");
  console.log("Pipeline 1: support-reply-v1 (subtle drift)");
  console.log("========================================");
  for (const h of subtleDrift.hops) {
    console.log(`\n[hop ${h.hopIndex} — ${h.agentId}]   ${fmtRisk(h.risk?.overallRisk ?? 0)}`);
    console.log(`  in:  ${h.input}`);
    console.log(`  out: ${h.output}`);
    const top = (h.risk?.categoryScores ?? [])
      .filter((c) => c.probability > 0.3)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 2);
    for (const t of top) {
      console.log(`     → ${t.category}: ${(t.probability * 100).toFixed(0)}%`);
    }
  }
  console.log(`\n• Cumulative drift hop0→final: ${fmtRisk(subtleDrift.cumulativeDrift)}`);
  console.log(`• Drift pattern: ${subtleDrift.driftPattern}`);
  const topDrifts = Object.entries(subtleDrift.driftByCategory)
    .filter(([, v]) => v > 0.3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  console.log(`• Top corrupted axes:`);
  for (const [cat, p] of topDrifts) {
    console.log(`    - ${cat}: ${(p * 100).toFixed(0)}%`);
  }
  console.log(`\nVerdict: pipeline introduced commitment + hedging + polarity shifts.`);
  console.log(`         Customer message went from "pretty sure I was charged twice" → "will issue refund".`);
  console.log(`         That's a liability event masked as an agent-pipeline quality improvement.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
