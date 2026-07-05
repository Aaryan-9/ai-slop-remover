import type { LanguageId } from "../types.js";

export interface LanguageConfig {
  id: LanguageId;
  extensions: string[];
  wasmPackage: string;
  wasmNames: string[];
}

export const languageConfigs: LanguageConfig[] = [
  {
    id: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    wasmPackage: "tree-sitter-javascript",
    wasmNames: ["tree-sitter-javascript.wasm", "javascript.wasm"]
  },
  {
    id: "typescript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    wasmPackage: "tree-sitter-typescript",
    wasmNames: ["tree-sitter-typescript.wasm", "tree-sitter-tsx.wasm", "typescript.wasm", "tsx.wasm"]
  },
  {
    id: "python",
    extensions: [".py", ".pyw"],
    wasmPackage: "tree-sitter-python",
    wasmNames: ["tree-sitter-python.wasm", "python.wasm"]
  },
  {
    id: "go",
    extensions: [".go"],
    wasmPackage: "tree-sitter-go",
    wasmNames: ["tree-sitter-go.wasm", "go.wasm"]
  },
  {
    id: "ruby",
    extensions: [".rb", ".rake"],
    wasmPackage: "tree-sitter-ruby",
    wasmNames: ["tree-sitter-ruby.wasm", "ruby.wasm"]
  },
  {
    id: "java",
    extensions: [".java"],
    wasmPackage: "tree-sitter-java",
    wasmNames: ["tree-sitter-java.wasm", "java.wasm"]
  },
  {
    id: "csharp",
    extensions: [".cs"],
    wasmPackage: "tree-sitter-c-sharp",
    wasmNames: ["tree-sitter-c_sharp.wasm", "tree-sitter-c-sharp.wasm", "c_sharp.wasm"]
  },
  {
    id: "rust",
    extensions: [".rs"],
    wasmPackage: "tree-sitter-rust",
    wasmNames: ["tree-sitter-rust.wasm", "rust.wasm"]
  },
  {
    id: "php",
    extensions: [".php"],
    wasmPackage: "tree-sitter-php",
    wasmNames: ["tree-sitter-php.wasm", "php.wasm"]
  }
];

export function languageForFile(filePath: string): LanguageId | undefined {
  const lower = filePath.toLowerCase();
  return languageConfigs.find((config) => config.extensions.some((ext) => lower.endsWith(ext)))?.id;
}

export function configForLanguage(language: LanguageId): LanguageConfig {
  const config = languageConfigs.find((candidate) => candidate.id === language);
  if (!config) throw new Error(`Unsupported language: ${language}`);
  return config;
}
