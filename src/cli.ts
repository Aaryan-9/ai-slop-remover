#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { readBaseline, writeBaseline } from "./baseline.js";
import { renderFixPlan } from "./fix.js";
import { renderHtmlReport } from "./report/html.js";
import { renderJsonReport } from "./report/json.js";
import { renderMarkdownReport } from "./report/markdown.js";
import { renderTerminalReport } from "./report/terminal.js";
import { scanRepo } from "./scan.js";
import type { CliScanOptions, ScanResult } from "./types.js";
import { normalizeThreshold } from "./utils/severity.js";

const program = new Command();

program
  .name("ai-slop-remover")
  .description("Find the slop AI coding tools leave behind: convention drift, comment noise, fake-done code, phantom imports.")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan a repository and report findings with a Slop Score.")
  .argument("[path]", "Repository path to scan", ".")
  .option("-f, --format <format>", "Report format: terminal, md, html, json, or both (md+html)", "terminal")
  .option("-o, --output <path>", "Output file or directory. Defaults to stdout (terminal/md/json) or ./ai-slop-report.html.")
  .option("--severity-threshold <level>", "Minimum severity: low, medium, or high", "low")
  .option("--exclude <glob>", "Additional ignore pattern. May be repeated.", collect, [])
  .option("--check", "Exit with code 1 when the gate fails (any finding, or --min-score if set)", false)
  .option("--min-score <n>", "With --check: fail only when the Slop Score drops below n")
  .option("--baseline", "Suppress findings recorded in .ai-slop-baseline.json", false)
  .option("--verbose", "Print parser warnings and progress details", false)
  .action(async (targetPath: string, rawOptions: Record<string, unknown>) => {
    try {
      const options = normalizeCliOptions(rawOptions);
      const result = await runScan(targetPath, options);
      await writeReports(result, options);

      if (options.verbose && result.parseWarnings.length > 0) {
        for (const warning of result.parseWarnings) process.stderr.write(`Parser note: ${warning}\n`);
      }

      if (options.check) {
        const gateFailure = options.minScore !== undefined
          ? result.score.score < options.minScore
            ? `Slop Score ${result.score.score} is below --min-score ${options.minScore}.`
            : undefined
          : result.findings.length > 0
            ? `${result.findings.length} finding(s) at or above the "${options.severityThreshold}" threshold.`
            : undefined;
        if (gateFailure) {
          process.stderr.write(`ai-slop-remover: check failed — ${gateFailure}\n`);
          process.exitCode = 1;
        }
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command("baseline")
  .description("Record current findings in .ai-slop-baseline.json so future scans report only new slop.")
  .argument("[path]", "Repository path to scan", ".")
  .option("--exclude <glob>", "Additional ignore pattern. May be repeated.", collect, [])
  .action(async (targetPath: string, rawOptions: Record<string, unknown>) => {
    try {
      const excludes = Array.isArray(rawOptions.exclude) ? rawOptions.exclude.map(String) : [];
      const root = path.resolve(targetPath);
      process.stderr.write(`Scanning ${root}\n`);
      const result = await scanRepo(root, { excludes, severityThreshold: "low" });
      const baselinePath = await writeBaseline(root, result.findings);
      process.stderr.write(`Recorded ${result.findings.length} finding(s) in ${baselinePath}\n`);
      process.stderr.write(`Future scans with --baseline will only report new slop.\n`);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("fix")
  .description("Emit a prioritized fix plan to hand to a coding agent (Claude Code, Cursor, Codex, ...).")
  .argument("[path]", "Repository path to scan", ".")
  .option("-o, --output <path>", "Write the plan to a file (e.g. SLOP-FIXES.md) instead of stdout")
  .option("--format <format>", "Plan format: md or json", "md")
  .option("--severity-threshold <level>", "Minimum severity: low, medium, or high", "low")
  .option("--exclude <glob>", "Additional ignore pattern. May be repeated.", collect, [])
  .option("--baseline", "Suppress findings recorded in .ai-slop-baseline.json", false)
  .action(async (targetPath: string, rawOptions: Record<string, unknown>) => {
    try {
      const format = String(rawOptions.format ?? "md");
      if (format !== "md" && format !== "json") {
        throw new Error(`Invalid fix format "${format}". Expected md or json.`);
      }
      const result = await runScan(targetPath, {
        format: "terminal",
        output: undefined,
        severityThreshold: normalizeThreshold(String(rawOptions.severityThreshold ?? "low")),
        exclude: Array.isArray(rawOptions.exclude) ? rawOptions.exclude.map(String) : [],
        verbose: false,
        check: false,
        baseline: Boolean(rawOptions.baseline)
      });
      const plan = format === "json" ? renderJsonReport(result) : renderFixPlan(result);
      if (rawOptions.output) {
        await fs.writeFile(String(rawOptions.output), plan, "utf8");
        process.stderr.write(`Wrote ${String(rawOptions.output)}\n`);
      } else {
        process.stdout.write(plan);
      }
    } catch (error) {
      fail(error);
    }
  });

await program.parseAsync();

async function runScan(targetPath: string, options: CliScanOptions): Promise<ScanResult> {
  const root = path.resolve(targetPath);
  process.stderr.write(`Scanning ${root}\n`);
  const baselineFingerprints = options.baseline ? await readBaseline(root) : undefined;
  if (options.baseline && !baselineFingerprints) {
    process.stderr.write(`No .ai-slop-baseline.json found in ${root}; run "ai-slop-remover baseline" first.\n`);
  }
  return scanRepo(root, {
    excludes: options.exclude,
    severityThreshold: options.severityThreshold,
    baselineFingerprints
  });
}

function normalizeCliOptions(raw: Record<string, unknown>): CliScanOptions {
  const format = String(raw.format ?? "terminal");
  if (format !== "terminal" && format !== "md" && format !== "html" && format !== "json" && format !== "both") {
    throw new Error(`Invalid format "${format}". Expected terminal, md, html, json, or both.`);
  }
  const minScore = raw.minScore === undefined ? undefined : Number(raw.minScore);
  if (minScore !== undefined && (!Number.isFinite(minScore) || minScore < 0 || minScore > 100)) {
    throw new Error(`Invalid --min-score "${String(raw.minScore)}". Expected a number between 0 and 100.`);
  }
  return {
    format,
    output: raw.output ? String(raw.output) : undefined,
    severityThreshold: normalizeThreshold(String(raw.severityThreshold ?? "low")),
    exclude: Array.isArray(raw.exclude) ? raw.exclude.map(String) : [],
    verbose: Boolean(raw.verbose),
    check: Boolean(raw.check) || minScore !== undefined,
    minScore,
    baseline: Boolean(raw.baseline)
  };
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function writeReports(result: ScanResult, options: CliScanOptions): Promise<void> {
  if (options.format === "terminal") {
    process.stdout.write(`${renderTerminalReport(result)}\n`);
    return;
  }

  if (options.format === "md" || options.format === "json") {
    const rendered = options.format === "md" ? renderMarkdownReport(result) : renderJsonReport(result);
    if (options.output) {
      await fs.writeFile(options.output, rendered, "utf8");
      process.stderr.write(`Wrote ${options.output}\n`);
    } else {
      process.stdout.write(rendered);
    }
    return;
  }

  if (options.format === "html") {
    const output = options.output ?? "ai-slop-report.html";
    await fs.writeFile(output, renderHtmlReport(result), "utf8");
    process.stderr.write(`Wrote ${output}\n`);
    return;
  }

  const outputDir = options.output ?? ".";
  await fs.mkdir(outputDir, { recursive: true });
  const markdownPath = path.join(outputDir, "ai-slop-report.md");
  const htmlPath = path.join(outputDir, "ai-slop-report.html");
  await fs.writeFile(markdownPath, renderMarkdownReport(result), "utf8");
  await fs.writeFile(htmlPath, renderHtmlReport(result), "utf8");
  process.stderr.write(`Wrote ${markdownPath}\n`);
  process.stderr.write(`Wrote ${htmlPath}\n`);
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ai-slop-remover: ${message}\n`);
  process.exitCode = 2;
}
