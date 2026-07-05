import { describe, expect, it } from "vitest";
import { fingerprintOf, withoutBaselined } from "../src/baseline.js";
import type { Finding } from "../src/types.js";

function finding(overrides: Partial<Finding>): Finding {
  return {
    category: "swallowed_errors",
    title: "Error swallowed silently",
    file: "src/jobs.ts",
    line_start: 10,
    line_end: 12,
    pattern_observed: "empty catch block",
    dominant_pattern: "errors handled",
    dominant_frequency: 1,
    severity: "medium",
    confidence: 0.9,
    fix_hint: "handle it",
    explanation: "e",
    evidence: "catch (error) {}",
    ...overrides
  };
}

describe("baseline fingerprints", () => {
  it("is stable across line-number changes", () => {
    const before = finding({ line_start: 10, line_end: 12 });
    const after = finding({ line_start: 40, line_end: 42 });
    expect(fingerprintOf(before)).toBe(fingerprintOf(after));
  });

  it("differs across files and categories", () => {
    expect(fingerprintOf(finding({}))).not.toBe(fingerprintOf(finding({ file: "src/other.ts" })));
    expect(fingerprintOf(finding({}))).not.toBe(fingerprintOf(finding({ category: "placeholder" })));
  });

  it("filters baselined findings only", () => {
    const known = finding({});
    const fresh = finding({ file: "src/new.ts" });
    const baseline = new Set([fingerprintOf(known)]);
    expect(withoutBaselined([known, fresh], baseline)).toEqual([fresh]);
    expect(withoutBaselined([known, fresh], undefined)).toHaveLength(2);
  });
});
