import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";
import { configForLanguage } from "./languages.js";
import type { LanguageId, ParsedFile, SourceFile, TreeSitterTree } from "../types.js";

const require = createRequire(import.meta.url);
type TreeSitterLanguage = Awaited<ReturnType<typeof Language.load>>;

export class TreeSitterParser {
  private initialized = false;
  private languages = new Map<LanguageId, TreeSitterLanguage>();
  private grammarWarnings = new Map<LanguageId, string>();
  private parser: Parser | undefined;

  async parseFiles(files: SourceFile[]): Promise<ParsedFile[]> {
    const parsed: ParsedFile[] = [];
    for (const file of files) {
      parsed.push(await this.parseFile(file));
    }
    return parsed;
  }

  private async parseFile(file: SourceFile): Promise<ParsedFile> {
    const warnings: string[] = [];
    try {
      const language = await this.loadLanguage(file.language);
      this.parser ??= new Parser();
      const parser = this.parser;
      parser.setLanguage(language);
      const tree = parser.parse(file.source) as TreeSitterTree;
      return {
        ...file,
        tree,
        rootNode: tree.rootNode,
        parseWarnings: warnings
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Tree-sitter unavailable for ${file.language}: ${message}`);
      return {
        ...file,
        parseWarnings: warnings
      };
    }
  }

  private async loadLanguage(languageId: LanguageId): Promise<TreeSitterLanguage> {
    const cached = this.languages.get(languageId);
    if (cached) return cached;

    const previousWarning = this.grammarWarnings.get(languageId);
    if (previousWarning) throw new Error(previousWarning);

    if (!this.initialized) {
      await Parser.init();
      this.initialized = true;
    }

    const wasmPath = await this.resolveWasmPath(languageId);
    const language = await Language.load(wasmPath);
    this.languages.set(languageId, language);
    return language;
  }

  private async resolveWasmPath(languageId: LanguageId): Promise<string> {
    const config = configForLanguage(languageId);
    const roots = new Set<string>();

    try {
      roots.add(path.dirname(require.resolve(`${config.wasmPackage}/package.json`)));
    } catch {
      this.grammarWarnings.set(languageId, `optional package ${config.wasmPackage} is not installed`);
      throw new Error(`optional package ${config.wasmPackage} is not installed`);
    }

    for (const root of [...roots]) {
      roots.add(path.join(root, "dist"));
      roots.add(path.join(root, "wasm"));
      roots.add(path.join(root, "prebuilds"));
      roots.add(path.join(root, "bindings"));
    }

    for (const root of roots) {
      for (const wasmName of config.wasmNames) {
        const candidate = path.join(root, wasmName);
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          // Continue probing common grammar package layouts.
        }
      }
    }

    for (const root of roots) {
      const discovered = await findWasm(root, new Set(config.wasmNames), 4);
      if (discovered) return discovered;
    }

    const message = `could not find a WASM grammar for ${languageId} in ${config.wasmPackage}`;
    this.grammarWarnings.set(languageId, message);
    throw new Error(message);
  }
}

async function findWasm(root: string, names: Set<string>, depth: number): Promise<string | undefined> {
  if (depth < 0) return undefined;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    // Probe directories may not exist in every grammar package layout.
    return undefined;
  }

  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && names.has(entry.name)) return candidate;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const discovered = await findWasm(path.join(root, entry.name), names, depth - 1);
    if (discovered) return discovered;
  }

  return undefined;
}
