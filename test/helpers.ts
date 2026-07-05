import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepo } from "../src/scan.js";
import type { Finding, ScanResult } from "../src/types.js";

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export async function scanFixture(name: string): Promise<ScanResult> {
  return scanRepo(path.join(fixturesRoot, name), {
    excludes: [],
    severityThreshold: "low"
  });
}

export function findingsInCategory(result: ScanResult, category: string): Finding[] {
  return result.findings.filter((finding) => finding.category === category);
}
