import { describe, expect, it } from "vitest";
import { computeScore, gradeFor } from "../src/score.js";
import type { Finding } from "../src/types.js";

function finding(overrides: Partial<Finding>): Finding {
  return {
    category: "comment_slop",
    title: "t",
    file: "src/a.ts",
    line_start: 1,
    line_end: 1,
    pattern_observed: "x",
    dominant_pattern: "y",
    dominant_frequency: 1,
    severity: "low",
    confidence: 0.8,
    fix_hint: "fix it",
    explanation: "e",
    ...overrides
  };
}

describe("computeScore", () => {
  it("gives a clean repo 100/A", () => {
    const report = computeScore([], 5000);
    expect(report.score).toBe(100);
    expect(report.grade).toBe("A");
  });

  it("penalizes high-severity findings more than low", () => {
    const low = computeScore([finding({ severity: "low" })], 1000);
    const high = computeScore([finding({ severity: "high" })], 1000);
    expect(high.score).toBeLessThan(low.score);
  });

  it("normalizes by repo size", () => {
    const small = computeScore([finding({})], 500);
    const large = computeScore([finding({})], 50000);
    expect(large.score).toBeGreaterThan(small.score);
  });

  it("caps a single category so one detector cannot zero the score", () => {
    const findings = Array.from({ length: 200 }, (_, index) =>
      finding({ severity: "high", line_start: index + 1 })
    );
    const report = computeScore(findings, 1000);
    expect(report.score).toBeGreaterThanOrEqual(75);
    expect(report.categories[0]!.penalty).toBe(25);
  });

  it("maps scores to grades", () => {
    expect(gradeFor(95)).toBe("A");
    expect(gradeFor(85)).toBe("B");
    expect(gradeFor(75)).toBe("C");
    expect(gradeFor(65)).toBe("D");
    expect(gradeFor(30)).toBe("F");
  });
});
