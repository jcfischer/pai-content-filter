/**
 * Schema for SOP (Standard Operating Procedure) markdown documents.
 * SOPs follow a required heading structure defined in pai-collab CONTRIBUTING.md.
 *
 * Required sections:
 * - # SOP: [Name]
 * - ## Why This Exists
 * - ## Pipeline (or ## Flow)
 * - ## Steps
 * - ## References
 */

export interface SopValidationResult {
  valid: boolean;
  errors: string[];
  sections_found: string[];
}

const REQUIRED_HEADINGS = [
  /^#\s+SOP:\s+.+/i, // # SOP: [Name]
  /^##\s+Why\s+This\s+Exists/i,
  /^##\s+(?:Pipeline|Flow)/i,
  /^##\s+Steps/i,
  /^##\s+References/i,
];

const HEADING_NAMES = [
  "# SOP: [Name]",
  "## Why This Exists",
  "## Pipeline (or ## Flow)",
  "## Steps",
  "## References",
];

export function validateSopStructure(markdown: string): SopValidationResult {
  const lines = markdown.split("\n");
  const headings = lines.filter((l) => l.trimStart().startsWith("#"));
  const errors: string[] = [];
  const sectionsFound: string[] = [];

  for (let i = 0; i < REQUIRED_HEADINGS.length; i++) {
    const pattern = REQUIRED_HEADINGS[i]!;
    const found = headings.some((h) => pattern.test(h.trim()));
    if (found) {
      sectionsFound.push(HEADING_NAMES[i]!);
    } else {
      errors.push(`Missing required section: ${HEADING_NAMES[i]}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sections_found: sectionsFound,
  };
}
