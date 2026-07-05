import { describe, expect, it } from "vitest";
import { findingsInCategory, scanFixture } from "../helpers.js";

describe("go parity", () => {
  it("flags undeclared modules, empty err checks, and blank-identifier errors", async () => {
    const result = await scanFixture("go-parity");

    const phantoms = findingsInCategory(result, "phantom_import");
    expect(phantoms).toHaveLength(1);
    expect(phantoms[0]!.evidence).toContain("github.com/imaginary/hallucinated");

    const swallowed = findingsInCategory(result, "swallowed_errors");
    const observed = swallowed.map((finding) => finding.pattern_observed);
    expect(observed).toContain("empty `if err != nil` block");
    expect(observed).toContain("error assigned to blank identifier");
  });
});

describe("java", () => {
  it("flags empty catch, printStackTrace-swallow, and not-implemented stubs", async () => {
    const result = await scanFixture("java-slop");

    const swallowed = findingsInCategory(result, "swallowed_errors");
    const observed = swallowed.map((finding) => finding.pattern_observed);
    expect(observed).toContain("empty catch block");
    expect(observed).toContain("catch that logs and swallows");

    const stubs = findingsInCategory(result, "placeholder");
    expect(stubs.some((finding) => finding.explanation.includes("exportOrders"))).toBe(true);
    // persist() throws real exceptions and must not be a stub.
    expect(stubs.some((finding) => finding.explanation.includes("persist"))).toBe(false);
  });
});

describe("csharp", () => {
  it("flags empty catch and NotImplementedException stubs", async () => {
    const result = await scanFixture("csharp-slop");

    const swallowed = findingsInCategory(result, "swallowed_errors");
    expect(swallowed.map((finding) => finding.pattern_observed)).toContain("empty catch block");

    const stubs = findingsInCategory(result, "placeholder");
    expect(stubs.some((finding) => finding.explanation.includes("Export"))).toBe(true);
  });
});

describe("rust", () => {
  it("flags undeclared crates and todo! stubs but keeps declared/local imports", async () => {
    const result = await scanFixture("rust-slop");

    const phantoms = findingsInCategory(result, "phantom_import");
    expect(phantoms).toHaveLength(1);
    expect(phantoms[0]!.evidence).toContain("imaginary_crate");

    const stubs = findingsInCategory(result, "placeholder");
    expect(stubs.some((finding) => finding.explanation.includes("export_report"))).toBe(true);
  });
});

describe("php", () => {
  it("flags empty catch and placeholder language", async () => {
    const result = await scanFixture("php-slop");

    const swallowed = findingsInCategory(result, "swallowed_errors");
    expect(swallowed.map((finding) => finding.pattern_observed)).toContain("empty catch block");

    const placeholders = findingsInCategory(result, "placeholder");
    expect(placeholders.some((finding) => finding.pattern_observed === "in a real implementation")).toBe(true);
  });
});
