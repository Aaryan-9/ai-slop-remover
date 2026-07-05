import path from "node:path";
import pc from "picocolors";
import type { Finding, ScanResult, Severity } from "../types.js";
import { groupBy } from "../utils/collections.js";
import { categoryLabel } from "../utils/text.js";

const MAX_FINDINGS_PER_CATEGORY = 8;
const CATEGORY_CAP = 25;

export function renderTerminalReport(result: ScanResult): string {
  const lines: string[] = [""];
  const durationSeconds = ((result.completedAt.getTime() - result.startedAt.getTime()) / 1000).toFixed(1);
  const repoName = path.basename(result.rootPath) || result.rootPath;

  lines.push(
    `  ${pc.bold("ai-slop-remover")} ${pc.dim(`· scanned ${repoName} (${result.files.length} files, ${formatLines(result.totalLines)} lines) in ${durationSeconds}s`)}`,
    ""
  );

  lines.push(`  ${pc.dim("Slop Score")}  ${scoreColor(result.score.score)(pc.bold(`${result.score.score} / 100`))}  ${scoreColor(result.score.score)(`(${result.score.grade})`)}`, "");

  if (result.baselinedCount > 0) {
    lines.push(`  ${pc.dim(`${result.baselinedCount} known finding(s) suppressed by baseline`)}`, "");
  }

  if (result.findings.length === 0) {
    lines.push(`  ${pc.green("✔ No slop found at the current threshold.")}`, "");
    return lines.join("\n");
  }

  const labelWidth = Math.max(...result.score.categories.map((category) => categoryLabel(category.category).length));
  for (const category of result.score.categories) {
    const filled = Math.max(1, Math.round((category.penalty / CATEGORY_CAP) * 10));
    const bar = pc.red("█".repeat(filled)) + pc.dim("░".repeat(Math.max(0, 10 - filled)));
    const label = categoryLabel(category.category).padEnd(labelWidth);
    lines.push(`  ${label}  ${bar}  ${String(category.findingCount).padStart(3)} finding(s)  ${pc.dim(`−${category.penalty.toFixed(1)} pts`)}`);
  }
  lines.push("");

  for (const [category, findings] of groupBy(result.findings, (finding) => finding.category)) {
    lines.push(`  ${pc.bold(categoryLabel(category))} ${pc.dim(`(${findings.length})`)}`);
    for (const finding of findings.slice(0, MAX_FINDINGS_PER_CATEGORY)) {
      lines.push(...renderFinding(finding));
    }
    if (findings.length > MAX_FINDINGS_PER_CATEGORY) {
      lines.push(`    ${pc.dim(`… and ${findings.length - MAX_FINDINGS_PER_CATEGORY} more — write the full report with --format md --output report.md`)}`);
    }
    lines.push("");
  }

  const highCount = result.findings.filter((finding) => finding.severity === "high").length;
  const summary = `${result.findings.length} finding(s) · ${highCount} high severity`;
  lines.push(`  ${pc.bold(summary)}`);
  lines.push(`  ${pc.dim("Hand the findings to your coding agent:")} ${pc.cyan("ai-slop-remover fix")}`, "");
  return lines.join("\n");
}

function renderFinding(finding: Finding): string[] {
  const location = pc.cyan(`${finding.file}:${finding.line_start}`);
  const rendered = [
    `    ${severityBadge(finding.severity)} ${location}  ${finding.title}`,
    `      ${pc.dim(finding.explanation)}`
  ];
  if (finding.evidence) rendered.push(`      ${pc.dim(`▸ ${finding.evidence}`)}`);
  rendered.push(`      ${pc.green("fix:")} ${finding.fix_hint}`);
  return rendered;
}

function severityBadge(severity: Severity): string {
  if (severity === "high") return pc.red("✖ high");
  if (severity === "medium") return pc.yellow("▲ med ");
  return pc.dim("• low ");
}

function scoreColor(score: number): (value: string) => string {
  if (score >= 90) return pc.green;
  if (score >= 70) return pc.yellow;
  return pc.red;
}

function formatLines(totalLines: number): string {
  return totalLines >= 1000 ? `${(totalLines / 1000).toFixed(1)}k` : String(totalLines);
}
