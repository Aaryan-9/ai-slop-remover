import fs from "node:fs/promises";
import path from "node:path";
import { withoutBaselined } from "./baseline.js";
import { crawlRepo } from "./crawl.js";
import { detectors } from "./detectors/index.js";
import { TreeSitterParser } from "./parser/treeSitter.js";
import { computeScore } from "./score.js";
import type { Finding, ParsedFile, ScanOptions, ScanResult } from "./types.js";
import { severityAtLeast } from "./utils/severity.js";

export async function scanRepo(rootPath: string, options: ScanOptions): Promise<ScanResult> {
  const startedAt = new Date();
  const root = path.resolve(rootPath);
  if (!(await fs.stat(root).catch(() => undefined))?.isDirectory()) {
    throw new Error(`"${root}" is not a directory.`);
  }
  const sourceFiles = await crawlRepo(root, options.excludes);
  const parser = new TreeSitterParser();
  const files = await parser.parseFiles(sourceFiles);

  const findings: Finding[] = [];
  for (const detector of detectors) {
    const detectorFindings = await detector.run({ rootPath: root, files });
    findings.push(...detectorFindings);
  }

  const unsuppressed = withoutSuppressed(findings, files);
  const thresholded = unsuppressed.filter((finding) => severityAtLeast(finding.severity, options.severityThreshold));
  const visible = withoutBaselined(thresholded, options.baselineFingerprints);
  const totalLines = files.reduce((sum, file) => sum + file.lineCount, 0);

  const parseWarnings = [...new Set(files.flatMap((file) => file.parseWarnings))];
  return {
    rootPath: root,
    files,
    findings: visible.sort(
      (a, b) => compareSeverity(b.severity, a.severity) || a.category.localeCompare(b.category) || a.file.localeCompare(b.file)
    ),
    totalLines,
    score: computeScore(visible, totalLines),
    baselinedCount: thresholded.length - visible.length,
    startedAt,
    completedAt: new Date(),
    parseWarnings
  };
}

function compareSeverity(a: string, b: string): number {
  const order: Record<string, number> = { low: 0, medium: 1, high: 2 };
  return (order[a] ?? 0) - (order[b] ?? 0);
}

/**
 * Inline suppression: a `slop-ignore` comment on (or directly above) the
 * flagged line drops the finding; `slop-ignore-file` in the first five lines
 * of a file drops every finding in it.
 */
function withoutSuppressed(findings: Finding[], files: ParsedFile[]): Finding[] {
  const linesByFile = new Map<string, string[]>();
  for (const file of files) linesByFile.set(file.relativePath, file.source.split(/\r\n|\r|\n/));

  return findings.filter((finding) => {
    const lines = linesByFile.get(finding.file);
    if (!lines) return true;
    if (lines.slice(0, 5).some((line) => line.includes("slop-ignore-file"))) return false;
    const flagged = lines[finding.line_start - 1] ?? "";
    const above = lines[finding.line_start - 2] ?? "";
    return !flagged.includes("slop-ignore") && !above.includes("slop-ignore");
  });
}
