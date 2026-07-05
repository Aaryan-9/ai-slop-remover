import { describe, expect, it } from "vitest";
import { findingsInCategory, scanFixture } from "../helpers.js";

describe("error handling drift detector", () => {
  it("flags the one function that throws where Result returns dominate", async () => {
    const result = await scanFixture("error-drift");
    const findings = findingsInCategory(result, "error_handling");

    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.file).toBe("src/api/accounts.ts");
    expect(finding.pattern_observed).toBe("exception throw");
    expect(finding.dominant_pattern).toBe("Result/Either return");
    expect(finding.explanation).toContain("deleteAccount");
    expect(finding.fix_hint).toContain("Result/Either return");
  });
});
