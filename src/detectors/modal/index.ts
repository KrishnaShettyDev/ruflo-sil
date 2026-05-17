/**
 * Modal shift detector
 *
 * Detects when modal verbs change strength/polarity between original and suggested:
 *   "this might be possible" -> "this must be possible"  (epistemic strengthening)
 *   "we should review" -> "we shouldn't review"           (deontic flip - also caught by polarity)
 *   "we can try" -> "we will try"                          (commitment shift - also reported)
 */

import {
  CategoryScore,
  CorruptionCategory,
  Detector,
  DetectorOptions,
} from "../../types/index.js";

// Modals grouped by strength level
const MODAL_STRENGTH: Record<string, number> = {
  // weak / possibility
  might: 1, may: 1, could: 1, can: 1,
  // moderate
  should: 2, ought: 2, would: 2,
  // strong / necessity
  must: 3, shall: 3, will: 3, have: 3, "has to": 3, "got to": 3,
  // negations are handled by polarity detector
};

const MODAL_RE =
  /\b(might|may|could|can|should|ought|would|must|shall|will)\b/gi;

function extractModals(text: string): string[] {
  const matches = text.toLowerCase().match(MODAL_RE) || [];
  return matches;
}

function strengthOf(modal: string): number {
  return MODAL_STRENGTH[modal] ?? 0;
}

export class ModalDetector implements Detector {
  readonly name = "modal-rules-v1";
  readonly categories: CorruptionCategory[] = [CorruptionCategory.MODAL_SHIFT];

  async score(
    original: string,
    suggested: string,
    _options: DetectorOptions,
  ): Promise<CategoryScore[]> {
    const origModals = extractModals(original);
    const suggModals = extractModals(suggested);

    if (origModals.length === 0 && suggModals.length === 0) {
      return [
        {
          category: CorruptionCategory.MODAL_SHIFT,
          probability: 0.0,
          severity: 1,
          evidence: [],
          source: this.name,
        },
      ];
    }

    const origAvg =
      origModals.length === 0
        ? 0
        : origModals.reduce((s, m) => s + strengthOf(m), 0) /
          origModals.length;
    const suggAvg =
      suggModals.length === 0
        ? 0
        : suggModals.reduce((s, m) => s + strengthOf(m), 0) /
          suggModals.length;

    const delta = Math.abs(origAvg - suggAvg);

    // delta of 2 = jumping from "might" to "must" => severe
    // delta of 1 = adjacent shift => moderate
    let probability = 0.0;
    let severity = 1;
    if (delta >= 2) {
      probability = 0.85;
      severity = 5;
    } else if (delta >= 1) {
      probability = 0.55;
      severity = 4;
    } else if (delta > 0) {
      probability = 0.25;
      severity = 3;
    }

    // Modal added or removed entirely is a stronger signal
    if (origModals.length !== suggModals.length) {
      probability = Math.min(1.0, probability + 0.2);
      severity = Math.max(severity, 4);
    }

    return [
      {
        category: CorruptionCategory.MODAL_SHIFT,
        probability,
        severity,
        evidence: [
          `original: ${origModals.join(",") || "∅"}`,
          `suggested: ${suggModals.join(",") || "∅"}`,
        ],
        source: this.name,
      },
    ];
  }
}
