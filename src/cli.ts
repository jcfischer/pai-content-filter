#!/usr/bin/env bun

import { filterContent } from "./lib/content-filter";
import { loadConfig } from "./lib/pattern-matcher";
import { resolve } from "path";

const CONFIG_PATH = resolve(import.meta.dir, "../config/filter-patterns.yaml");

function printUsage(): void {
  console.log(`Usage: content-filter <command> [options]

Commands:
  check <file>     Check a file against the content filter
  config           Display loaded filter configuration summary

Options:
  --json           Machine-readable JSON output
  --config <path>  Path to filter-patterns.yaml (default: bundled config)
  --format <fmt>   Override file format detection (yaml|json|markdown|mixed)
  -h, --help       Show this help message

Exit codes:
  0  ALLOWED or HUMAN_REVIEW
  1  Error
  2  BLOCKED`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printUsage();
    process.exit(0);
  }

  const jsonFlag = args.includes("--json");
  const configIdx = args.indexOf("--config");
  const configPath =
    configIdx >= 0 ? args[configIdx + 1] ?? CONFIG_PATH : CONFIG_PATH;
  const formatIdx = args.indexOf("--format");
  const formatOverride = formatIdx >= 0 ? args[formatIdx + 1] : undefined;

  const command = args[0];

  switch (command) {
    case "check": {
      const filePath = args.find(
        (a, i) =>
          i > 0 &&
          !a.startsWith("--") &&
          args[i - 1] !== "--config" &&
          args[i - 1] !== "--format"
      );

      if (!filePath) {
        console.error("Error: no file specified");
        console.error("Usage: content-filter check <file>");
        process.exit(1);
      }

      try {
        const format = formatOverride
          ? (formatOverride as "yaml" | "json" | "markdown" | "mixed")
          : undefined;
        const result = filterContent(filePath, format, configPath);

        if (jsonFlag) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`File: ${result.file}`);
          console.log(`Format: ${result.format}`);
          console.log(`Decision: ${result.decision}`);

          if (result.encodings.length > 0) {
            console.log(`\nEncoding detections:`);
            for (const enc of result.encodings) {
              console.log(
                `  [${enc.type}] line ${enc.line}:${enc.column} — ${enc.matched_text}`
              );
            }
          }

          if (result.matches.length > 0) {
            console.log(`\nPattern matches:`);
            for (const m of result.matches) {
              console.log(
                `  [${m.pattern_id}] ${m.pattern_name} (${m.severity}) line ${m.line}:${m.column} — "${m.matched_text}"`
              );
            }
          }

          if (!result.schema_valid) {
            console.log(`\nSchema validation: FAILED`);
          }
        }

        // Exit code: 0 for ALLOWED/HUMAN_REVIEW, 2 for BLOCKED
        process.exit(result.decision === "BLOCKED" ? 2 : 0);
      } catch (e) {
        if (jsonFlag) {
          console.log(
            JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            })
          );
        } else {
          console.error(
            `Error: ${e instanceof Error ? e.message : String(e)}`
          );
        }
        process.exit(1);
      }
    }

    case "config": {
      try {
        const config = loadConfig(configPath);
        if (jsonFlag) {
          console.log(
            JSON.stringify(
              {
                version: config.version,
                pattern_count: config.patterns.length,
                encoding_rule_count: config.encoding_rules.length,
                categories: {
                  injection: config.patterns.filter(
                    (p) => p.category === "injection"
                  ).length,
                  exfiltration: config.patterns.filter(
                    (p) => p.category === "exfiltration"
                  ).length,
                  tool_invocation: config.patterns.filter(
                    (p) => p.category === "tool_invocation"
                  ).length,
                },
              },
              null,
              2
            )
          );
        } else {
          console.log(`Filter Configuration v${config.version}`);
          console.log(`  Patterns: ${config.patterns.length}`);
          console.log(
            `    Injection:       ${config.patterns.filter((p) => p.category === "injection").length}`
          );
          console.log(
            `    Exfiltration:    ${config.patterns.filter((p) => p.category === "exfiltration").length}`
          );
          console.log(
            `    Tool invocation: ${config.patterns.filter((p) => p.category === "tool_invocation").length}`
          );
          console.log(
            `  Encoding rules: ${config.encoding_rules.length}`
          );
        }
      } catch (e) {
        console.error(
          `Error loading config: ${e instanceof Error ? e.message : String(e)}`
        );
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main();
