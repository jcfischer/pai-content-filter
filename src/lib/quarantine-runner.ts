import { readFileSync } from "fs";
import type {
  CrossProjectProfile,
  QuarantineConfig,
  QuarantineResult,
  TypedReference,
} from "./types";
import { CrossProjectProfileSchema, DEFAULT_QUARANTINE_CONFIG } from "./types";
import { validateProvenance } from "./typed-reference";

/**
 * Load and validate a cross-project MCP profile.
 */
export function loadProfile(profilePath: string): CrossProjectProfile {
  const raw = readFileSync(profilePath, "utf-8");
  const parsed = JSON.parse(raw);
  return CrossProjectProfileSchema.parse(parsed);
}

/**
 * Build a QuarantineConfig with defaults.
 */
export function buildDefaultConfig(
  profilePath: string,
  overrides?: Partial<QuarantineConfig>
): QuarantineConfig {
  return {
    timeoutMs: overrides?.timeoutMs ?? DEFAULT_QUARANTINE_CONFIG.timeoutMs,
    profilePath,
    command: overrides?.command,
  };
}

/**
 * Run a quarantined process to read cross-project content.
 *
 * Spawns a subprocess (default: `k cross-project`, overridable via config.command),
 * passes file list as arguments, captures stdout as JSON array of TypedReferences,
 * validates provenance on each, and returns a QuarantineResult.
 */
export async function runQuarantine(
  files: string[],
  config: QuarantineConfig
): Promise<QuarantineResult> {
  const startTime = performance.now();

  // Empty file list — return immediately
  if (files.length === 0) {
    return {
      success: true,
      references: [],
      errors: [],
      durationMs: 0,
      filesProcessed: 0,
      exitCode: null,
    };
  }

  const cmd = config.command ?? "k";
  const args = config.command ? files : ["cross-project", ...files];

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let timedOut = false;

  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    // Timeout handling
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, config.timeoutMs);

    // Read stdout and stderr
    stdout = await new Response(proc.stdout).text();
    stderr = await new Response(proc.stderr).text();
    exitCode = await proc.exited;

    clearTimeout(timer);
  } catch (e) {
    const durationMs = Math.round(performance.now() - startTime);
    return {
      success: false,
      references: [],
      errors: [`Process error: ${e instanceof Error ? e.message : String(e)}`],
      durationMs,
      filesProcessed: files.length,
      exitCode: null,
    };
  }

  const durationMs = Math.round(performance.now() - startTime);

  // Check timeout
  if (timedOut) {
    return {
      success: false,
      references: [],
      errors: [`Timeout after ${config.timeoutMs}ms`],
      durationMs,
      filesProcessed: files.length,
      exitCode,
    };
  }

  // Check non-zero exit
  if (exitCode !== 0) {
    return {
      success: false,
      references: [],
      errors: [
        `Process exited with code ${exitCode}`,
        ...(stderr.trim() ? [`stderr: ${stderr.trim()}`] : []),
      ],
      durationMs,
      filesProcessed: files.length,
      exitCode,
    };
  }

  // Parse stdout as JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return {
      success: false,
      references: [],
      errors: [
        `Failed to parse stdout as JSON`,
        `Raw output: ${stdout.slice(0, 200)}`,
      ],
      durationMs,
      filesProcessed: files.length,
      exitCode,
    };
  }

  // Must be an array
  if (!Array.isArray(parsed)) {
    return {
      success: false,
      references: [],
      errors: [`Expected JSON array, got ${typeof parsed}`],
      durationMs,
      filesProcessed: files.length,
      exitCode,
    };
  }

  // Validate provenance on each reference
  const validRefs: TypedReference[] = [];
  const errors: string[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const provResult = validateProvenance(item);
    if (provResult.valid) {
      validRefs.push(item as TypedReference);
    } else {
      errors.push(
        `Reference [${i}] invalid: ${provResult.errors.join(", ")}`
      );
    }
  }

  return {
    success: true,
    references: validRefs,
    errors,
    durationMs,
    filesProcessed: files.length,
    exitCode,
  };
}
