import type {
  PatternMatch,
  EncodingMatch,
  ScoredDetection,
  SeverityTier,
} from "./types";

/**
 * Base confidence by pattern severity and category.
 *
 * - block + injection/exfiltration → CRITICAL (0.7 base)
 * - block + tool_invocation/pii → HIGH (0.6 base)
 * - review → MEDIUM (0.4 base)
 * - placeholder_skipped → LOW (0.2 base)
 */
function baseConfidence(match: PatternMatch): {
  confidence: number;
  severity: SeverityTier;
} {
  if (match.placeholder_skipped) {
    return { confidence: 0.2, severity: "LOW" };
  }

  if (match.severity === "block") {
    if (
      match.category === "injection" ||
      match.category === "exfiltration"
    ) {
      return { confidence: 0.7, severity: "CRITICAL" };
    }
    return { confidence: 0.6, severity: "HIGH" };
  }

  // review severity
  return { confidence: 0.4, severity: "MEDIUM" };
}

/**
 * Group matches by line number for proximity boosting.
 * Matches on the same line are considered co-located.
 */
function groupByLine(
  matches: PatternMatch[]
): Map<number, PatternMatch[]> {
  const groups = new Map<number, PatternMatch[]>();
  for (const match of matches) {
    const existing = groups.get(match.line) ?? [];
    existing.push(match);
    groups.set(match.line, existing);
  }
  return groups;
}

/**
 * Compute the proximity boost for a match based on how many other
 * patterns matched on the same line.
 *
 * Each additional co-located match adds 0.15 to confidence (capped at 1.0).
 * This implements the issue's formula: confidence = Math.min(base + (colocated * 0.15), 1.0)
 */
function proximityBoost(colocatedCount: number): number {
  return colocatedCount * 0.15;
}

/**
 * Score pattern matches with confidence and severity tiers.
 *
 * Each PatternMatch gets a ScoredDetection with:
 * - Base confidence from severity + category mapping
 * - Proximity boost when multiple patterns match the same line
 * - Severity tier (CRITICAL, HIGH, MEDIUM, LOW)
 *
 * Returns scored detections sorted by confidence (highest first).
 */
export function scoreDetections(
  matches: PatternMatch[],
  encodings: EncodingMatch[]
): ScoredDetection[] {
  if (matches.length === 0 && encodings.length === 0) {
    return [];
  }

  const lineGroups = groupByLine(matches);
  const scored: ScoredDetection[] = [];

  for (const match of matches) {
    const { confidence: base, severity } = baseConfidence(match);
    const colocated = (lineGroups.get(match.line) ?? []).length - 1;
    const boost = proximityBoost(colocated);
    const confidence = Math.min(base + boost, 1.0);

    scored.push({
      pattern_id: match.pattern_id,
      confidence: Math.round(confidence * 100) / 100,
      severity,
    });
  }

  // Encoding detections are always CRITICAL with high confidence
  for (const encoding of encodings) {
    scored.push({
      pattern_id: `encoding:${encoding.type}`,
      confidence: 0.9,
      severity: "CRITICAL",
    });
  }

  // Sort by confidence descending
  scored.sort((a, b) => b.confidence - a.confidence);

  return scored;
}

/**
 * Compute overall confidence and severity from scored detections.
 *
 * Overall confidence: maximum confidence across all detections.
 * Overall severity: highest severity tier present.
 */
export function overallScore(
  detections: ScoredDetection[]
): { confidence: number; severity: SeverityTier } | null {
  if (detections.length === 0) return null;

  const tierOrder: Record<SeverityTier, number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };

  let maxConfidence = 0;
  let highestTier: SeverityTier = "LOW";

  for (const d of detections) {
    if (d.confidence > maxConfidence) maxConfidence = d.confidence;
    if (tierOrder[d.severity] > tierOrder[highestTier]) {
      highestTier = d.severity;
    }
  }

  return {
    confidence: Math.round(maxConfidence * 100) / 100,
    severity: highestTier,
  };
}
