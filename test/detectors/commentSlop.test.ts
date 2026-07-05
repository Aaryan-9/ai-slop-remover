import { describe, expect, it } from "vitest";
import { findingsInCategory, scanFixture } from "../helpers.js";

describe("comment slop detector", () => {
  it("flags redundant, banner, step, and emoji comments but keeps meaningful ones", async () => {
    const result = await scanFixture("comment-slop");
    const findings = findingsInCategory(result, "comment_slop");
    const titles = findings.map((finding) => finding.title);

    expect(titles).toContain("Decorative banner comment");
    expect(titles).toContain("Step-by-step narration comment");
    expect(titles).toContain("Emoji in comments or log output");
    expect(titles).toContain("Comment restates the code below it");

    const redundant = findings.filter((finding) => finding.title === "Comment restates the code below it");
    const redundantLines = redundant.map((finding) => finding.line_start);
    // "Fetch the order from the database" restates fetchOrderFromDatabase.
    expect(redundantLines).toContain(8);

    // The "why" comment (discount incident) and the TODO must survive.
    const flaggedLines = new Set(findings.map((finding) => finding.line_start));
    expect(flaggedLines.has(28)).toBe(false);
    expect(flaggedLines.has(29)).toBe(false);
    expect(flaggedLines.has(33)).toBe(false);
  });
});
