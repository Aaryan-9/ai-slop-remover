import { fingerprintOf } from "../baseline.js";
import type { ScanResult } from "../types.js";

/** Stable machine-readable schema for tooling and coding agents. */
export function renderJsonReport(result: ScanResult): string {
  const payload = {
    schema_version: 1,
    root: result.rootPath,
    generated_at: result.completedAt.toISOString(),
    duration_ms: result.completedAt.getTime() - result.startedAt.getTime(),
    stats: {
      files: result.files.length,
      lines: result.totalLines,
      findings: result.findings.length,
      baselined: result.baselinedCount
    },
    score: result.score,
    parse_warnings: result.parseWarnings,
    findings: result.findings.map((finding) => ({
      fingerprint: fingerprintOf(finding),
      ...finding
    }))
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
