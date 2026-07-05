import { describe, expect, it } from "vitest";
import { findingsInCategory, scanFixture } from "../helpers.js";

describe("phantom imports detector", () => {
  it("flags undeclared packages and unresolved relative imports only", async () => {
    const result = await scanFixture("phantom-imports");
    const findings = findingsInCategory(result, "phantom_import");
    const evidence = findings.map((finding) => finding.evidence ?? "");

    expect(evidence.some((text) => text.includes("super-array-utils"))).toBe(true);
    expect(evidence.some((text) => text.includes("./missing.js"))).toBe(true);
    expect(evidence.some((text) => text.includes("fastapi"))).toBe(true);

    // Declared, builtin, local, and aliased (yaml -> pyyaml) imports stay quiet.
    expect(evidence.some((text) => text.includes("commander"))).toBe(false);
    expect(evidence.some((text) => text.includes("node:fs"))).toBe(false);
    expect(evidence.some((text) => text.includes("./helpers.js"))).toBe(false);
    expect(evidence.some((text) => text.includes("requests"))).toBe(false);
    expect(evidence.some((text) => text.includes("yaml"))).toBe(false);
    expect(evidence.some((text) => text.includes("from utils import"))).toBe(false);
    expect(findings.every((finding) => finding.severity === "high")).toBe(true);
  });
});
