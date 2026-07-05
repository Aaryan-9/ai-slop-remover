import path from "node:path";
import type { Finding, ScanResult } from "../types.js";
import { groupBy } from "../utils/collections.js";
import { categoryLabel, percent } from "../utils/text.js";

export function renderMarkdownReport(result: ScanResult): string {
  const durationSeconds = ((result.completedAt.getTime() - result.startedAt.getTime()) / 1000).toFixed(1);
  const byCategory = groupBy(result.findings, (finding) => finding.category);
  const lines: string[] = [
    "# AI Slop Remover Report",
    "",
    `Scanned \`${path.basename(result.rootPath) || result.rootPath}\` in ${durationSeconds}s.`,
    "",
    `**Slop Score: ${result.score.score}/100 (${result.score.grade})** — ${result.findings.length} finding(s) across ${byCategory.size} categories in ${result.files.length} files.`,
    result.baselinedCount > 0 ? `\n${result.baselinedCount} known finding(s) suppressed by baseline.\n` : "",
    "## Summary",
    "",
    "| Category | Findings |",
    "| --- | ---: |"
  ];

  for (const [category, findings] of byCategory) {
    lines.push(`| ${categoryLabel(category)} | ${findings.length} |`);
  }

  if (result.parseWarnings.length > 0) {
    lines.push("", "## Parser Notes", "");
    for (const warning of result.parseWarnings) lines.push(`- ${warning}`);
  }

  for (const [category, findings] of byCategory) {
    lines.push("", `## ${categoryLabel(category)}`, "");
    for (const finding of findings) {
      lines.push(...renderFinding(finding), "");
    }
  }

  if (result.findings.length === 0) {
    lines.push("", "No convention drift findings met the selected threshold.");
  }

  return `${lines.join("\n")}\n`;
}

function renderFinding(finding: Finding): string[] {
  const location = `${finding.file}:${finding.line_start}`;
  const result = [
    `### ${finding.title}`,
    "",
    `- **Location:** \`${location}\``,
    `- **Severity:** ${finding.severity}`,
    `- **Observed:** ${finding.pattern_observed}`,
    `- **Dominant:** ${finding.dominant_pattern} (${percent(finding.dominant_frequency)})`,
    `- **Why:** ${finding.explanation}`
  ];
  if (finding.group) result.push(`- **Group:** ${finding.group}`);
  if (finding.evidence) result.push(`- **Evidence:** \`${finding.evidence.replaceAll("`", "'")}\``);
  return result;
}

