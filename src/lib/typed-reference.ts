import { createHash, randomUUID } from "crypto";
import type {
  FilterResult,
  TypedReference,
  ProvenanceResult,
  TypedReferenceFilterResult,
} from "./types";
import { TypedReferenceSchema } from "./types";

/**
 * Map FilterDecision to TypedReference filter_result.
 * Only ALLOWED, OVERRIDE, HUMAN_APPROVED are valid.
 */
const DECISION_MAP: Record<string, TypedReferenceFilterResult | undefined> = {
  ALLOWED: "PASSED",
  OVERRIDE: "OVERRIDE",
  HUMAN_APPROVED: "HUMAN_APPROVED",
};

/**
 * Extract origin from file path — last two path segments.
 */
export function extractOrigin(filePath: string): string {
  const segments = filePath.split("/").filter((s) => s !== "");
  if (segments.length <= 2) return segments.join("/");
  return segments.slice(-2).join("/");
}

/**
 * Create a TypedReference from a FilterResult.
 *
 * Only accepts decisions that indicate content is safe:
 * ALLOWED, OVERRIDE, HUMAN_APPROVED.
 *
 * Returns a frozen (immutable) TypedReference.
 */
export function createTypedReference(
  result: FilterResult,
  content: string,
  data: Record<string, unknown>,
  opts?: { origin?: string }
): Readonly<TypedReference> {
  const filterResult = DECISION_MAP[result.decision];

  if (!filterResult) {
    throw new Error(
      `Cannot create TypedReference from ${result.decision} decision. ` +
        `Only ALLOWED, OVERRIDE, HUMAN_APPROVED are accepted.`
    );
  }

  const ref: TypedReference = {
    id: randomUUID(),
    origin: opts?.origin ?? extractOrigin(result.file),
    trust_level: "untrusted",
    content_hash: createHash("sha256").update(content).digest("hex"),
    filter_result: filterResult,
    consumed_at: new Date().toISOString(),
    format: result.format,
    data,
    source_file: result.file,
  };

  return Object.freeze(ref);
}

/**
 * Validate provenance of a TypedReference.
 * Uses Zod schema for validation. Works on deserialized (JSON.parse) objects.
 */
export function validateProvenance(ref: unknown): ProvenanceResult {
  const result = TypedReferenceSchema.safeParse(ref);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    ),
  };
}
