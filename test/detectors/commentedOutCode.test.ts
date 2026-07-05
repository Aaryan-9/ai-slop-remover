import { describe, expect, it } from "vitest";
import { findingsInCategory, scanFixture } from "../helpers.js";

describe("commented-out code detector", () => {
  it("flags disabled code blocks but keeps prose comments", async () => {
    const result = await scanFixture("commented-out-code");
    const findings = findingsInCategory(result, "commented_out_code");

    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.file).toBe("src/sync.ts");
    // The disabled block spans lines 2-6.
    expect(finding.line_start).toBe(2);
    expect(finding.line_end).toBeGreaterThanOrEqual(5);
    // The rate-limit prose comment (lines 10-12) must not be flagged.
  });
});
