import fs from "node:fs/promises";
import path from "node:path";
import { globby } from "globby";
import ignorePackage, { type Ignore } from "ignore";

// ignore@5 ships a CJS default export that NodeNext types as a namespace.
const createIgnoreMatcher = ignorePackage as unknown as () => Ignore;
import { languageForFile } from "./parser/languages.js";
import type { SourceFile } from "./types.js";
import { toPosixPath } from "./utils/paths.js";

const builtinIgnores = [
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "vendor",
  "generated",
  "**/*.min.js",
  "**/*.map",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml"
];

export async function crawlRepo(rootPath: string, extraExcludes: string[] = []): Promise<SourceFile[]> {
  const root = path.resolve(rootPath);
  const matcher = createIgnoreMatcher().add(builtinIgnores).add(extraExcludes);
  await addGitignore(root, matcher);

  const entries = await globby(["**/*"], {
    cwd: root,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    absolute: false,
    gitignore: true
  });

  const sourceFiles: SourceFile[] = [];
  for (const entry of entries.sort()) {
    const relativePath = toPosixPath(entry);
    if (matcher.ignores(relativePath)) continue;

    const language = languageForFile(relativePath);
    if (!language) continue;

    const absolutePath = path.join(root, relativePath);
    const source = await fs.readFile(absolutePath, "utf8");
    sourceFiles.push({
      absolutePath,
      relativePath,
      language,
      source,
      lineCount: source.length === 0 ? 0 : source.split(/\r\n|\r|\n/).length
    });
  }

  return sourceFiles;
}

async function addGitignore(root: string, matcher: Ignore): Promise<void> {
  try {
    const content = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    matcher.add(content);
  } catch {
    // Repos without .gitignore still get the built-in excludes.
  }
}
