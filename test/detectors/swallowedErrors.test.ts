import { describe, expect, it } from "vitest";
import { findingsInCategory, scanFixture } from "../helpers.js";

describe("swallowed errors detector", () => {
  it("flags empty and log-only catches but keeps real handling", async () => {
    const result = await scanFixture("swallowed-errors");
    const findings = findingsInCategory(result, "swallowed_errors");
    const observed = findings.map((finding) => finding.pattern_observed);

    expect(observed).toContain("empty catch block");
    expect(observed).toContain("catch that logs and swallows");
    expect(observed).toContain("except-and-pass");
    expect(observed).toContain("bare except");

    // runAuditedJob (logger + rethrow) and load_config (raise from) are fine.
    const tsFindings = findings.filter((finding) => finding.file === "src/jobs.ts");
    expect(tsFindings).toHaveLength(2);
    const pyFindings = findings.filter((finding) => finding.file === "src/worker.py");
    expect(pyFindings).toHaveLength(2);
  });
});
