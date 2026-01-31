import { z } from "zod";

/**
 * Schema for PROJECT.yaml (the structured YAML format used in pai-collab).
 * EXTEND.yaml follows a similar structure for skill customizations.
 *
 * Based on pai-collab CONTRIBUTING.md format spec.
 */

const ContributorSchema = z.object({
  zone: z.enum(["maintainer", "trusted", "untrusted"]),
  since: z.string(),
  promoted: z.string().optional(),
  promoted_by: z.string().optional(),
  notes: z.string().optional(),
  contributions: z.array(z.string()).optional(),
});

const SourceSchema = z.object({
  repo: z.string(),
  branch: z.string().optional(),
});

export const ProjectYamlSchema = z
  .object({
    name: z.string(),
    maintainer: z.string(),
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
    created: z.union([z.string(), z.date()]),
    type: z
      .enum(["skill", "bundle", "tool", "infrastructure"])
      .optional(),
    upstream: z.string().optional(),
    fork: z.string().optional(),
    source: SourceSchema.optional(),
    contrib_branch: z.string().optional(),
    source_branch: z.string().optional(),
    tag: z.string().optional(),
    paths: z.array(z.string()).optional(),
    tests: z.string().optional(),
    docs: z.string().optional(),
    contributors: z.record(z.string(), ContributorSchema),
  })
  .strict();

export type ProjectYaml = z.infer<typeof ProjectYamlSchema>;
