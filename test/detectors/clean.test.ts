import { describe, expect, it } from "vitest";
import { scanFixture } from "../helpers.js";

describe("clean fixture (false-positive guard)", () => {
  it("produces zero findings on well-written code", async () => {
    const result = await scanFixture("clean");
    expect(result.findings).toEqual([]);
  });
});
