import { z } from "zod";

/**
 * Schema for REGISTRY.md table rows.
 * REGISTRY.md contains markdown tables — we validate the parsed row data.
 *
 * Two tables: Active Projects and Agent Registry.
 */

export const ProjectRowSchema = z.object({
  project: z.string().min(1),
  maintainer: z.string().startsWith("@"),
  status: z.enum([
    "proposed",
    "building",
    "hardening",
    "contrib-prep",
    "review",
    "shipped",
    "evolving",
    "archived",
  ]),
  source: z.string().min(1),
  contributors: z.string(),
});

export const AgentRowSchema = z.object({
  agent: z.string().min(1),
  operator: z.string().startsWith("@"),
  platform: z.string().min(1),
  skills: z.string(),
  availability: z.enum(["open", "busy", "offline"]),
  current_work: z.string(),
});

export type ProjectRow = z.infer<typeof ProjectRowSchema>;
export type AgentRow = z.infer<typeof AgentRowSchema>;

/**
 * Parse a markdown table into an array of row objects.
 * Expects standard markdown table with header row, separator row, and data rows.
 */
export function parseMarkdownTable(
  markdown: string
): Record<string, string>[] {
  const lines = markdown
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));

  if (lines.length < 3) return []; // need header + separator + at least 1 row

  const headerLine = lines[0]!;
  const headers = headerLine
    .split("|")
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .map((h) =>
      h
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "")
    );

  const rows: Record<string, string>[] = [];

  // Skip header (index 0) and separator (index 1)
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]!;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = cells[j]?.trim() ?? "";
    }
    rows.push(row);
  }

  return rows;
}
