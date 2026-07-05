import { toPosixPath } from "./paths.js";

const testDirectory = /(?:^|\/)(?:__tests__|__mocks__|test|tests|spec|specs|e2e|fixtures|testdata)(?:\/|$)/i;
const testFileName = /(?:\.(?:test|spec|stories)\.[^/]+|_test\.(?:go|py|rb|js|ts)|_spec\.rb|^test_[^/]*\.py|^conftest\.py|(?:Test|Tests|IT)\.java|Tests?\.cs|Test\.php)$/i;
const configFileName = /(?:^|\/)(?:[^/]*\.config\.[^/]+|\.[^/]*rc(?:\.[^/]+)?|setup\.py|conftest\.py|gulpfile\.[^/]+|gruntfile\.[^/]+|babel\.[^/]+|webpack\.[^/]+|rollup\.[^/]+|vite\.[^/]+|jest\.[^/]+|vitest\.[^/]+|tailwind\.[^/]+|postcss\.[^/]+)$/i;
const scriptOrMigrationPath = /(?:^|\/)(?:scripts?|migrations?|migrate|seeds?|seeders|tools|bin|examples?|demos?|benchmarks?)(?:\/|$)/i;

export function isTestFile(relativePath: string): boolean {
  const posix = toPosixPath(relativePath);
  const base = posix.split("/").pop() ?? posix;
  return testDirectory.test(posix) || testFileName.test(base);
}

export function isConfigFile(relativePath: string): boolean {
  return configFileName.test(toPosixPath(relativePath));
}

export function isScriptOrMigration(relativePath: string): boolean {
  return scriptOrMigrationPath.test(toPosixPath(relativePath));
}

const examplePath = /(?:^|\/)(?:examples?|demos?|samples?|playground)(?:\/|$)/i;

/** Example/demo code intentionally simplifies and repeats itself. */
export function isExampleFile(relativePath: string): boolean {
  return examplePath.test(toPosixPath(relativePath));
}

export function isApplicationCode(relativePath: string): boolean {
  return !isTestFile(relativePath) && !isConfigFile(relativePath) && !isScriptOrMigration(relativePath);
}
