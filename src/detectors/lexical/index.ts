/**
 * Lexical-axis detectors — commitment, quantifier, temporal, hedging, subject swap.
 *
 * Each is rule-based, sub-millisecond, complementary to the NLI cross-encoder.
 * The NLI detector catches semantic contradictions; these catch the specific
 * lexical operations that cause pragmatic corruption.
 */

import {
  CategoryScore,
  CorruptionCategory,
  Detector,
  DetectorOptions,
} from "../../types/index.js";

// ----------------------------------------------------------------------------
// COMMITMENT DISTORTION
// "I'll try" -> "I will"; "maybe" -> "definitely"; "probably" -> "surely"
// ----------------------------------------------------------------------------

const COMMITMENT_TIERS: Record<string, number> = {
  // tentative
  maybe: 1, perhaps: 1, possibly: 1, "i'll try": 1, try: 1, attempt: 1,
  "looking into": 1, "may be able": 1, hopefully: 1,
  // probable
  probably: 2, likely: 2, "should be": 2, "plan to": 2, "intend to": 2,
  // certain / committed
  definitely: 3, certainly: 3, surely: 3, will: 3, "going to": 3,
  "i will": 3, guaranteed: 3, "for sure": 3, "100%": 3,
};

function commitmentLevel(text: string): { level: number; matches: string[] } {
  const lower = " " + text.toLowerCase() + " ";
  let maxLevel = 0;
  const matches: string[] = [];
  for (const [phrase, lvl] of Object.entries(COMMITMENT_TIERS)) {
    if (lower.includes(" " + phrase + " ") || lower.includes(" " + phrase + ".") || lower.includes(" " + phrase + ",")) {
      if (lvl > maxLevel) maxLevel = lvl;
      matches.push(phrase);
    }
  }
  return { level: maxLevel, matches };
}

export class CommitmentDetector implements Detector {
  readonly name = "commitment-rules-v1";
  readonly categories = [CorruptionCategory.COMMITMENT_DISTORTION];

  async score(
    original: string,
    suggested: string,
    _opts: DetectorOptions,
  ): Promise<CategoryScore[]> {
    const o = commitmentLevel(original);
    const s = commitmentLevel(suggested);
    const delta = Math.abs(o.level - s.level);

    let probability = 0;
    let severity = 1;
    if (delta >= 2) {
      probability = 0.8;
      severity = 5;
    } else if (delta === 1) {
      probability = 0.45;
      severity = 4;
    }

    return [
      {
        category: CorruptionCategory.COMMITMENT_DISTORTION,
        probability,
        severity,
        evidence: [...o.matches.map((m) => `original:${m}`), ...s.matches.map((m) => `suggested:${m}`)],
        source: this.name,
      },
    ];
  }
}

// ----------------------------------------------------------------------------
// QUANTIFIER SHIFT
// "some users" -> "all users"; "few errors" -> "many errors"
// ----------------------------------------------------------------------------

const QUANTIFIER_LEVELS: Record<string, number> = {
  none: 0, "no one": 0, nobody: 0, zero: 0,
  few: 1, "a few": 1, several: 1, some: 2, "a number of": 2,
  many: 3, most: 4, majority: 4, almost: 4, nearly: 4,
  all: 5, every: 5, everyone: 5, everybody: 5, each: 5,
};

function quantifierLevel(text: string): { level: number | null; matches: string[] } {
  const lower = " " + text.toLowerCase() + " ";
  let level: number | null = null;
  const matches: string[] = [];
  for (const [phrase, lvl] of Object.entries(QUANTIFIER_LEVELS)) {
    if (lower.includes(" " + phrase + " ")) {
      if (level === null || Math.abs(lvl - 2.5) > Math.abs(level - 2.5)) {
        level = lvl;
      }
      matches.push(phrase);
    }
  }
  return { level, matches };
}

export class QuantifierDetector implements Detector {
  readonly name = "quantifier-rules-v1";
  readonly categories = [CorruptionCategory.QUANTIFIER_SHIFT];

  async score(
    original: string,
    suggested: string,
    _opts: DetectorOptions,
  ): Promise<CategoryScore[]> {
    const o = quantifierLevel(original);
    const s = quantifierLevel(suggested);
    if (o.level === null || s.level === null) {
      return [
        {
          category: CorruptionCategory.QUANTIFIER_SHIFT,
          probability: 0,
          severity: 1,
          evidence: [],
          source: this.name,
        },
      ];
    }
    const delta = Math.abs(o.level - s.level);
    let probability = 0;
    let severity = 1;
    if (delta >= 3) {
      probability = 0.85;
      severity = 5;
    } else if (delta >= 2) {
      probability = 0.6;
      severity = 4;
    } else if (delta === 1) {
      probability = 0.3;
      severity = 3;
    }
    return [
      {
        category: CorruptionCategory.QUANTIFIER_SHIFT,
        probability,
        severity,
        evidence: [...o.matches.map((m) => `original:${m}`), ...s.matches.map((m) => `suggested:${m}`)],
        source: this.name,
      },
    ];
  }
}

// ----------------------------------------------------------------------------
// TEMPORAL SHIFT
// "soon" -> "now"; "by Friday" -> "next Friday"
// ----------------------------------------------------------------------------

const TEMPORAL_TOKENS: Record<string, number> = {
  now: 0, immediately: 0, "right now": 0, today: 0,
  soon: 1, shortly: 1, "in a bit": 1,
  tomorrow: 2, "next day": 2,
  "this week": 3, "by friday": 3, "this month": 3,
  "next week": 4, "next month": 4,
  later: 5, eventually: 5, someday: 5,
};

function temporalLevel(text: string): { level: number | null; matches: string[] } {
  const lower = " " + text.toLowerCase() + " ";
  let level: number | null = null;
  const matches: string[] = [];
  for (const [phrase, lvl] of Object.entries(TEMPORAL_TOKENS)) {
    if (lower.includes(" " + phrase + " ") || lower.includes(" " + phrase + ".")) {
      level = lvl;
      matches.push(phrase);
    }
  }
  return { level, matches };
}

export class TemporalDetector implements Detector {
  readonly name = "temporal-rules-v1";
  readonly categories = [CorruptionCategory.TEMPORAL_SHIFT];

  async score(
    original: string,
    suggested: string,
    _opts: DetectorOptions,
  ): Promise<CategoryScore[]> {
    const o = temporalLevel(original);
    const s = temporalLevel(suggested);
    if (o.level === null || s.level === null) {
      return [
        {
          category: CorruptionCategory.TEMPORAL_SHIFT,
          probability: 0,
          severity: 1,
          evidence: [],
          source: this.name,
        },
      ];
    }
    const delta = Math.abs(o.level - s.level);
    let probability = 0;
    let severity = 1;
    if (delta >= 3) {
      probability = 0.8;
      severity = 5;
    } else if (delta >= 2) {
      probability = 0.6;
      severity = 4;
    } else if (delta === 1) {
      probability = 0.52;
      severity = 3;
    }
    return [
      {
        category: CorruptionCategory.TEMPORAL_SHIFT,
        probability,
        severity,
        evidence: [...o.matches.map((m) => `original:${m}`), ...s.matches.map((m) => `suggested:${m}`)],
        source: this.name,
      },
    ];
  }
}

// ----------------------------------------------------------------------------
// HEDGING SHIFT
// "I think" / "in my opinion" / "kind of" appearing or disappearing
// ----------------------------------------------------------------------------

const HEDGES = [
  "i think", "i believe", "in my opinion", "perhaps", "maybe", "kind of",
  "sort of", "i guess", "i suppose", "arguably", "presumably", "seems",
  "appears to", "i feel", "i suspect", "possibly", "tentatively",
];

function countHedges(text: string): { count: number; hits: string[] } {
  const lower = " " + text.toLowerCase() + " ";
  const hits: string[] = [];
  for (const h of HEDGES) {
    if (lower.includes(" " + h + " ") || lower.includes(" " + h + ",")) {
      hits.push(h);
    }
  }
  return { count: hits.length, hits };
}

export class HedgingDetector implements Detector {
  readonly name = "hedging-rules-v1";
  readonly categories = [CorruptionCategory.HEDGING_SHIFT];

  async score(
    original: string,
    suggested: string,
    _opts: DetectorOptions,
  ): Promise<CategoryScore[]> {
    const o = countHedges(original);
    const s = countHedges(suggested);
    const delta = Math.abs(o.count - s.count);
    let probability = 0;
    let severity = 1;
    if (delta >= 2) {
      probability = 0.65;
      severity = 3;
    } else if (delta === 1) {
      probability = 0.42;
      severity = 3;
    }
    return [
      {
        category: CorruptionCategory.HEDGING_SHIFT,
        probability,
        severity,
        evidence: [...o.hits.map((h) => `original:${h}`), ...s.hits.map((h) => `suggested:${h}`)],
        source: this.name,
      },
    ];
  }
}

// ----------------------------------------------------------------------------
// SUBJECT/OBJECT SWAP
// "I asked her" -> "she asked me"; "I" -> "we"
// ----------------------------------------------------------------------------

const PRONOUNS = new Set([
  "i", "me", "my", "mine", "myself",
  "you", "your", "yours", "yourself",
  "we", "us", "our", "ours", "ourselves",
  "they", "them", "their", "theirs", "themselves",
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
]);

function pronounProfile(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const tok of text
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .split(/\s+/)) {
    if (PRONOUNS.has(tok)) {
      map.set(tok, (map.get(tok) ?? 0) + 1);
    }
  }
  return map;
}

export class SubjectSwapDetector implements Detector {
  readonly name = "subject-rules-v1";
  readonly categories = [CorruptionCategory.SUBJECT_OBJECT_SWAP];

  async score(
    original: string,
    suggested: string,
    _opts: DetectorOptions,
  ): Promise<CategoryScore[]> {
    const o = pronounProfile(original);
    const s = pronounProfile(suggested);

    // Count pronouns that appear in one but not the other, OR change in count
    const allPronouns = new Set([...o.keys(), ...s.keys()]);
    let changed = 0;
    const evidence: string[] = [];
    for (const p of allPronouns) {
      const oc = o.get(p) ?? 0;
      const sc = s.get(p) ?? 0;
      if (oc !== sc) {
        changed++;
        evidence.push(`${p}: ${oc}->${sc}`);
      }
    }

    let probability = 0;
    let severity = 1;
    if (changed >= 3) {
      probability = 0.65;
      severity = 5;
    } else if (changed === 2) {
      probability = 0.4;
      severity = 4;
    } else if (changed === 1) {
      probability = 0.15;
      severity = 3;
    }

    return [
      {
        category: CorruptionCategory.SUBJECT_OBJECT_SWAP,
        probability,
        severity,
        evidence,
        source: this.name,
      },
    ];
  }
}
