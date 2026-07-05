import { describe, expect, it } from "vitest";
import { isApplicationCode, isConfigFile, isScriptOrMigration, isTestFile } from "../src/utils/fileKinds.js";

describe("isTestFile", () => {
  it("matches test directories and file names", () => {
    expect(isTestFile("src/__tests__/user.ts")).toBe(true);
    expect(isTestFile("test/user.test.ts")).toBe(true);
    expect(isTestFile("src/user.spec.tsx")).toBe(true);
    expect(isTestFile("pkg/server_test.go")).toBe(true);
    expect(isTestFile("app/test_models.py")).toBe(true);
    expect(isTestFile("spec/models/user_spec.rb")).toBe(true);
    expect(isTestFile("cypress/e2e/login.ts")).toBe(true);
  });

  it("does not match regular source files", () => {
    expect(isTestFile("src/services/user.ts")).toBe(false);
    expect(isTestFile("src/contest.ts")).toBe(false);
    expect(isTestFile("src/attestation.py")).toBe(false);
  });
});

describe("isConfigFile", () => {
  it("matches config files", () => {
    expect(isConfigFile("vitest.config.ts")).toBe(true);
    expect(isConfigFile("packages/app/vite.config.mts")).toBe(true);
    expect(isConfigFile(".eslintrc.js")).toBe(true);
  });

  it("does not match source files", () => {
    expect(isConfigFile("src/configService.ts")).toBe(false);
  });
});

describe("isScriptOrMigration", () => {
  it("matches scripts, migrations, and seeds", () => {
    expect(isScriptOrMigration("scripts/release.ts")).toBe(true);
    expect(isScriptOrMigration("db/migrations/20240101_add_users.ts")).toBe(true);
    expect(isScriptOrMigration("seeds/users.py")).toBe(true);
  });

  it("does not match application code", () => {
    expect(isScriptOrMigration("src/services/user.ts")).toBe(false);
  });
});

describe("isApplicationCode", () => {
  it("is the negation of the other kinds", () => {
    expect(isApplicationCode("src/services/user.ts")).toBe(true);
    expect(isApplicationCode("test/user.test.ts")).toBe(false);
    expect(isApplicationCode("scripts/release.ts")).toBe(false);
  });
});
