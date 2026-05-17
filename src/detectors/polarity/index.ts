/**
 * Polarity detector
 *
 * Two sub-categories:
 *  - polarity_negation: explicit negation appears/disappears between original and suggested
 *    Example: "I can do it" -> "I can't do it"  (negation inserted)
 *  - polarity_antonym: a content word is replaced by its lexical antonym
 *    Example: "approve" -> "reject"; "include" -> "exclude"
 *
 * Pure rules. Fast. Runs in <2ms typically.
 */

import {
  CategoryScore,
  CorruptionCategory,
  Detector,
  DetectorOptions,
} from "../../types/index.js";

// Negation cues — contracted and uncontracted
const NEGATION_CUES = new Set([
  "not", "n't", "no", "never", "none", "nothing", "nobody",
  "nowhere", "neither", "nor", "without", "lack", "lacks", "lacking",
  "cannot", "cant", "wont", "shouldnt", "couldnt", "wouldnt",
  "isnt", "arent", "wasnt", "werent", "dont", "doesnt", "didnt",
  "hasnt", "havent", "hadnt",
]);

// Common antonym pairs that flip meaning in business / interpersonal / code contexts
const ANTONYM_PAIRS: Array<[string, string]> = [
  ["approve", "reject"], ["accept", "decline"], ["accept", "refuse"],
  ["include", "exclude"], ["allow", "deny"], ["allow", "forbid"],
  ["enable", "disable"], ["activate", "deactivate"], ["start", "stop"],
  ["open", "close"], ["add", "remove"], ["increase", "decrease"],
  ["up", "down"], ["agree", "disagree"], ["confirm", "cancel"],
  ["confirm", "deny"], ["available", "unavailable"], ["possible", "impossible"],
  ["like", "dislike"], ["love", "hate"], ["happy", "sad"], ["safe", "unsafe"],
  ["legal", "illegal"], ["valid", "invalid"], ["true", "false"],
  ["correct", "incorrect"], ["right", "wrong"], ["yes", "no"],
  ["success", "failure"], ["win", "lose"], ["pass", "fail"],
  ["accept", "reject"], ["join", "leave"], ["arrive", "depart"],
  ["buy", "sell"], ["grant", "deny"], ["permit", "prohibit"],
  ["before", "after"], ["above", "below"], ["greater", "less"],
  ["more", "less"], ["maximum", "minimum"], ["best", "worst"],
  // Code-relevant
  ["true", "false"], ["null", "notnull"], ["push", "pull"],
  ["create", "delete"], ["insert", "remove"], ["bind", "unbind"],
  ["mount", "unmount"], ["lock", "unlock"], ["encrypt", "decrypt"],
];

const ANTONYM_LOOKUP = new Map<string, Set<string>>();
for (const [a, b] of ANTONYM_PAIRS) {
  if (!ANTONYM_LOOKUP.has(a)) ANTONYM_LOOKUP.set(a, new Set());
  if (!ANTONYM_LOOKUP.has(b)) ANTONYM_LOOKUP.set(b, new Set());
  ANTONYM_LOOKUP.get(a)!.add(b);
  ANTONYM_LOOKUP.get(b)!.add(a);
}

function tokenize(text: string): string[] {
  return text
    // split camelCase first while case is preserved: allowAccess -> allow Access
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/'/g, "'")
    .replace(/n't/g, " n't")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function countNegations(tokens: string[]): { count: number; cues: string[] } {
  const cues: string[] = [];
  let count = 0;
  for (const tok of tokens) {
    const clean = tok.replace(/'/g, "");
    if (NEGATION_CUES.has(tok) || NEGATION_CUES.has(clean)) {
      count++;
      cues.push(tok);
    }
  }
  return { count, cues };
}

function findAntonymReplacements(
  origTokens: string[],
  suggTokens: string[],
): Array<{ from: string; to: string }> {
  const origSet = new Set(origTokens);
  const suggSet = new Set(suggTokens);
  const replacements: Array<{ from: string; to: string }> = [];

  for (const tok of origSet) {
    const antonyms = ANTONYM_LOOKUP.get(tok);
    if (!antonyms) continue;
    for (const antonym of antonyms) {
      if (suggSet.has(antonym) && !suggSet.has(tok)) {
        replacements.push({ from: tok, to: antonym });
        break; // one antonym hit per original token is enough
      }
    }
  }
  return replacements;
}

export class PolarityDetector implements Detector {
  readonly name = "polarity-rules-v1";
  readonly categories: CorruptionCategory[] = [
    CorruptionCategory.POLARITY_NEGATION,
    CorruptionCategory.POLARITY_ANTONYM,
  ];

  async score(
    original: string,
    suggested: string,
    _options: DetectorOptions,
  ): Promise<CategoryScore[]> {
    const origTokens = tokenize(original);
    const suggTokens = tokenize(suggested);

    // --- Negation flip detection ---
    const origNeg = countNegations(origTokens);
    const suggNeg = countNegations(suggTokens);
    const negationDelta = Math.abs(origNeg.count - suggNeg.count);

    let negationScore: CategoryScore;
    if (negationDelta === 0) {
      negationScore = {
        category: CorruptionCategory.POLARITY_NEGATION,
        probability: 0.0,
        severity: 1,
        evidence: [],
        source: this.name,
      };
    } else {
      // Single negation flip is high-confidence corruption
      const probability = Math.min(1.0, 0.7 + 0.15 * negationDelta);
      const allCues = [...new Set([...origNeg.cues, ...suggNeg.cues])];
      negationScore = {
        category: CorruptionCategory.POLARITY_NEGATION,
        probability,
        severity: 5,
        evidence: allCues,
        source: this.name,
      };
    }

    // --- Antonym replacement detection ---
    const replacements = findAntonymReplacements(origTokens, suggTokens);
    let antonymScore: CategoryScore;
    if (replacements.length === 0) {
      antonymScore = {
        category: CorruptionCategory.POLARITY_ANTONYM,
        probability: 0.0,
        severity: 1,
        evidence: [],
        source: this.name,
      };
    } else {
      const probability = Math.min(1.0, 0.75 + 0.1 * replacements.length);
      antonymScore = {
        category: CorruptionCategory.POLARITY_ANTONYM,
        probability,
        severity: 5,
        evidence: replacements.map((r) => `${r.from}->${r.to}`),
        source: this.name,
      };
    }

    return [negationScore, antonymScore];
  }
}
