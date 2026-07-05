import { describe, expect, it } from "vitest";
import { findingsInCategory, scanFixture } from "../helpers.js";

describe("placeholder detector", () => {
  it("flags placeholder phrases, stub functions, and mock data", async () => {
    const result = await scanFixture("placeholders");
    const findings = findingsInCategory(result, "placeholder");
    const observed = findings.map((finding) => finding.pattern_observed);

    expect(observed).toContain("in a real implementation");
    expect(observed).toContain("a not-implemented throw");
    expect(observed).toContain("an empty body");
    expect(observed).toContain("only `pass`");
    expect(observed).toContain("`raise NotImplementedError`");
    expect(observed).toContain("placeholder person name");
    expect(observed).toContain("placeholder email");

    const files = new Set(findings.map((finding) => finding.file));
    expect(files).toContain("src/payment.ts");
    expect(files).toContain("src/tasks.py");

    // Working functions must not be flagged.
    const stubNames = findings
      .filter((finding) => finding.title === "Function is an unimplemented stub")
      .map((finding) => finding.explanation);
    expect(stubNames.join(" ")).not.toContain("totalOf");
    expect(stubNames.join(" ")).not.toContain("count_rows");
  });
});
