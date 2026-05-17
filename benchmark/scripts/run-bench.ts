/**
 * ICOR-Bench evaluation runner.
 *
 * Run:
 *   npx tsx benchmark/scripts/run-bench.ts                              # local mocks
 *   HF_API_KEY=... npx tsx benchmark/scripts/run-bench.ts               # hosted NLI
 *   HF_API_KEY=... ANTHROPIC_API_KEY=... npx tsx benchmark/scripts/run-bench.ts
 *
 * Optionally:
 *   --data benchmark/data/seed.jsonl
 *   --out  benchmark/data/results.jsonl
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIL } from "../../src/core/sil.js";
import { CorruptionCategory } from "../../src/types/index.js";

interface BenchExample {
  id: string;
  pillar: "A" | "B" | "C";
  category: string;
  surface: string;
  original: string;
  suggested: string;
  label: "corruption" | "clean";
  severity: number;
  notes?: string;
}

interface BenchResult {
  id: string;
  category: string;
  surface: string;
  expected: "corruption" | "clean";
  predicted: "corruption" | "clean";
  predictedAction: string;
  risk: number;
  topCategory: string;
  topProb: number;
  correct: boolean;
  latencyMs: number;
}

function parseArgs(): {
  dataPath: string;
  outPath: string;
  threshold: number | undefined;
  trajectories: number;
  cachePath: string | undefined;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tRaw = get("--threshold");
  const trajRaw = get("--trajectories");
  return {
    dataPath: get("--data") ?? path.join(here, "..", "data", "seed.jsonl"),
    outPath: get("--out") ?? path.join(here, "..", "data", "results.jsonl"),
    threshold: tRaw !== undefined ? parseFloat(tRaw) : undefined,
    trajectories: trajRaw !== undefined ? parseInt(trajRaw, 10) : 3,
    cachePath: get("--cache"),
  };
}

function loadJsonl(p: string): BenchExample[] {
  const text = fs.readFileSync(p, "utf-8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

async function main() {
  const { dataPath, outPath, threshold, trajectories, cachePath } = parseArgs();
  console.log(`[bench] loading ${dataPath}`);
  const examples = loadJsonl(dataPath);
  console.log(`[bench] ${examples.length} examples`);
  if (threshold !== undefined) console.log(`[bench] threshold override = ${threshold}`);
  if (trajectories !== 3) console.log(`[bench] parallelTrajectories = ${trajectories}`);
  if (cachePath) console.log(`[bench] judge cache = ${cachePath}`);

  const sil = process.env.HF_API_KEY
    ? SIL.hosted({
        hfApiKey: process.env.HF_API_KEY!,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        openrouterApiKey: process.env.OPENROUTER_API_KEY,
        enableJudge: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY),
        judgeCachePath: cachePath,
        thresholdOverride: threshold,
      })
    : SIL.local();

  const backend = process.env.HF_API_KEY ? "hosted" : "local-mocks";
  const judge = process.env.OPENROUTER_API_KEY
    ? "openrouter"
    : process.env.ANTHROPIC_API_KEY
      ? "anthropic-direct"
      : "disabled";
  console.log(`[bench] backend = ${backend}, judge = ${judge}`);

  const results: BenchResult[] = [];
  const t0 = performance.now();

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    const tStart = performance.now();
    const out = await sil.score({
      original: ex.original,
      suggested: ex.suggested,
      surface: ex.surface as any,
      parallelTrajectories: trajectories,
    });
    const latencyMs = Math.round(performance.now() - tStart);
    const predicted: "corruption" | "clean" =
      out.action === "pass" ? "clean" : "corruption";
    const top = [...out.categoryScores].sort(
      (a, b) => b.probability * b.severity - a.probability * a.severity,
    )[0];

    results.push({
      id: ex.id,
      category: ex.category,
      surface: ex.surface,
      expected: ex.label,
      predicted,
      predictedAction: out.action,
      risk: out.overallRisk,
      topCategory: top?.category ?? "none",
      topProb: top?.probability ?? 0,
      correct: predicted === ex.label,
      latencyMs,
    });

    process.stdout.write(
      `\r[bench] ${i + 1}/${examples.length}  ${predicted === ex.label ? "✓" : "✗"} ${ex.id}     `,
    );
  }
  process.stdout.write("\n");

  // ------- metrics -------
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const accuracy = correct / total;

  const corruptions = results.filter((r) => r.expected === "corruption");
  const cleans = results.filter((r) => r.expected === "clean");

  const tp = corruptions.filter((r) => r.predicted === "corruption").length;
  const fn = corruptions.filter((r) => r.predicted === "clean").length;
  const fp = cleans.filter((r) => r.predicted === "corruption").length;
  const tn = cleans.filter((r) => r.predicted === "clean").length;

  const recall = tp / Math.max(tp + fn, 1);
  const precision = tp / Math.max(tp + fp, 1);
  const f1 = (2 * precision * recall) / Math.max(precision + recall, 1e-9);
  const fpRate = fp / Math.max(fp + tn, 1);

  // Per-category breakdown
  const byCategory = new Map<string, { total: number; correct: number }>();
  for (const r of results) {
    const k = r.category;
    if (!byCategory.has(k)) byCategory.set(k, { total: 0, correct: 0 });
    const v = byCategory.get(k)!;
    v.total++;
    if (r.correct) v.correct++;
  }

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];

  const elapsed = (performance.now() - t0) / 1000;

  console.log("\n========== ICOR-Bench results ==========");
  console.log(`backend:        ${backend}`);
  console.log(`examples:       ${total}`);
  console.log(`accuracy:       ${(accuracy * 100).toFixed(1)}%`);
  console.log(`recall:         ${(recall * 100).toFixed(1)}%   (true-positive rate on corruptions)`);
  console.log(`precision:      ${(precision * 100).toFixed(1)}%`);
  console.log(`F1:             ${(f1 * 100).toFixed(1)}%`);
  console.log(`false-pos rate: ${(fpRate * 100).toFixed(1)}%   (false alarms on clean paraphrases)`);
  console.log(`latency p50:    ${p50}ms`);
  console.log(`latency p95:    ${p95}ms`);
  console.log(`latency p99:    ${p99}ms`);
  console.log(`wall time:      ${elapsed.toFixed(1)}s`);

  console.log("\n--- per-category accuracy ---");
  const cats = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, v] of cats) {
    const pct = ((v.correct / v.total) * 100).toFixed(0);
    const bar = "█".repeat(Math.round(v.correct / v.total * 20));
    console.log(`  ${k.padEnd(26)} ${v.correct}/${v.total}  ${pct}%  ${bar}`);
  }

  console.log("\n--- failures ---");
  const failures = results.filter((r) => !r.correct);
  for (const f of failures) {
    console.log(`  ${f.id} [${f.category}/${f.surface}]: expected=${f.expected}, predicted=${f.predicted} (risk=${f.risk.toFixed(2)})`);
  }

  fs.writeFileSync(outPath, results.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`\n[bench] wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
