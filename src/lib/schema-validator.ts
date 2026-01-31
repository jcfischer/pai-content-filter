import type { FileFormat, SchemaResult } from "./types";
import { ProjectYamlSchema } from "../../config/schemas/extend-yaml";
import {
  ProjectRowSchema,
  AgentRowSchema,
  parseMarkdownTable,
} from "../../config/schemas/registry-md";
import { validateSopStructure } from "../../config/schemas/sop";

/**
 * Validate structured content against format-specific schemas.
 */
export function validateSchema(
  content: string,
  format: FileFormat
): SchemaResult {
  switch (format) {
    case "yaml":
      return validateYaml(content);
    case "json":
      return validateJson(content);
    case "markdown":
      return validateMarkdown(content);
    case "mixed":
      return validateMarkdown(content);
  }
}

function validateYaml(content: string): SchemaResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseNestedYaml(content);
  } catch (e) {
    return {
      valid: false,
      format: "yaml",
      errors: [
        `YAML parse error: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }

  const result = ProjectYamlSchema.safeParse(parsed);
  if (!result.success) {
    return {
      valid: false,
      format: "yaml",
      errors: result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      ),
    };
  }

  return { valid: true, format: "yaml", errors: [] };
}

function validateJson(content: string): SchemaResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return {
      valid: false,
      format: "json",
      errors: [
        `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }

  const result = ProjectYamlSchema.safeParse(parsed);
  if (!result.success) {
    return {
      valid: false,
      format: "json",
      errors: result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      ),
    };
  }

  return { valid: true, format: "json", errors: [] };
}

function validateMarkdown(content: string): SchemaResult {
  if (content.includes("| Project") || content.includes("| Agent")) {
    return validateRegistryMd(content);
  }

  if (/^#\s+SOP:/im.test(content)) {
    return validateSop(content);
  }

  // Generic markdown — no strict schema, passes validation
  return { valid: true, format: "markdown", errors: [] };
}

function validateRegistryMd(content: string): SchemaResult {
  const errors: string[] = [];
  const sections = content.split(/^##\s+/m);

  for (const section of sections) {
    if (!section.includes("|")) continue;

    const tableLines = section
      .split("\n")
      .filter((l) => l.trim().startsWith("|"))
      .join("\n");

    if (!tableLines) continue;

    const rows = parseMarkdownTable(tableLines);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;

      if ("project" in row && "maintainer" in row) {
        const result = ProjectRowSchema.safeParse(row);
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push(
              `Project table row ${i + 1}: ${issue.path.join(".")}: ${issue.message}`
            );
          }
        }
      }

      if ("agent" in row && "operator" in row) {
        const result = AgentRowSchema.safeParse(row);
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push(
              `Agent table row ${i + 1}: ${issue.path.join(".")}: ${issue.message}`
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    format: "markdown",
    errors,
  };
}

/**
 * Parse nested YAML for PROJECT.yaml format.
 * Handles top-level scalars, nested objects (contributors), and arrays.
 */
function parseNestedYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent > 0) {
      i++;
      continue;
    }

    // Top-level key
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) {
      i++;
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (value) {
      // Strip quotes
      result[key] = stripQuote(value);
      i++;
    } else {
      // Nested block — determine if object or array
      const block = collectBlock(lines, i + 1, 2);
      result[key] = block.value;
      i = block.nextIdx;
    }
  }

  return result;
}

function collectBlock(
  lines: string[],
  start: number,
  minIndent: number
): { value: unknown; nextIdx: number } {
  // Find first content line
  let first = start;
  while (first < lines.length) {
    const t = lines[first]!.trim();
    if (t !== "" && !t.startsWith("#")) break;
    first++;
  }
  if (first >= lines.length) return { value: {}, nextIdx: lines.length };

  const firstLine = lines[first]!;
  const firstIndent = firstLine.length - firstLine.trimStart().length;
  if (firstIndent < minIndent) return { value: {}, nextIdx: first };

  if (firstLine.trimStart().startsWith("- ")) {
    return collectArray(lines, first, firstIndent);
  }
  return collectObject(lines, first, firstIndent);
}

function collectObject(
  lines: string[],
  start: number,
  blockIndent: number
): { value: Record<string, unknown>; nextIdx: number } {
  const obj: Record<string, unknown> = {};
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent < blockIndent) break;
    if (indent > blockIndent) {
      i++;
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) {
      i++;
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();

    if (val) {
      obj[key] = stripQuote(val);
      i++;
    } else {
      const nested = collectBlock(lines, i + 1, indent + 2);
      obj[key] = nested.value;
      i = nested.nextIdx;
    }
  }

  return { value: obj, nextIdx: i };
}

function collectArray(
  lines: string[],
  start: number,
  blockIndent: number
): { value: unknown[]; nextIdx: number } {
  const arr: unknown[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent < blockIndent) break;

    if (trimmed.startsWith("- ")) {
      const val = trimmed.slice(2).trim();
      arr.push(stripQuote(val));
      i++;
    } else {
      i++;
    }
  }

  return { value: arr, nextIdx: i };
}

function stripQuote(v: string): string {
  if (
    (v.startsWith("'") && v.endsWith("'")) ||
    (v.startsWith('"') && v.endsWith('"'))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function validateSop(content: string): SchemaResult {
  const result = validateSopStructure(content);
  return {
    valid: result.valid,
    format: "markdown",
    errors: result.errors,
  };
}
