import type { ParsedFile, TreeSitterNode } from "./types.js";
import { dedupeBy } from "./utils/collections.js";
import { lineForIndex } from "./utils/text.js";

export interface FunctionLike {
  name: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  nodeType: string;
  /** Present when the function came from a tree-sitter parse. */
  node?: TreeSitterNode;
}

const jsFunctionTypes = new Set([
  "function_declaration",
  "method_definition",
  "generator_function_declaration",
  "arrow_function",
  "function",
  "function_expression"
]);

const pythonFunctionTypes = new Set(["function_definition"]);
const goFunctionTypes = new Set(["function_declaration", "method_declaration"]);
const rubyFunctionTypes = new Set(["method"]);
const javaFunctionTypes = new Set(["method_declaration", "constructor_declaration"]);
const csharpFunctionTypes = new Set(["method_declaration", "constructor_declaration", "local_function_statement"]);
const rustFunctionTypes = new Set(["function_item"]);
const phpFunctionTypes = new Set(["function_definition", "method_declaration"]);

export function findNodes(root: TreeSitterNode | undefined, predicate: (node: TreeSitterNode) => boolean): TreeSitterNode[] {
  if (!root) return [];
  const result: TreeSitterNode[] = [];
  const stack: TreeSitterNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (predicate(node)) result.push(node);
    for (let i = node.namedChildCount - 1; i >= 0; i -= 1) {
      const child = node.namedChild(i);
      if (child) stack.push(child);
    }
  }
  return result;
}

export function extractFunctions(file: ParsedFile): FunctionLike[] {
  const fromAst = extractFunctionsFromAst(file);
  if (fromAst.length > 0) return fromAst;
  return extractFunctionsFallback(file);
}

function extractFunctionsFromAst(file: ParsedFile): FunctionLike[] {
  const functions = findNodes(file.rootNode, (node) => isFunctionNode(file.language, node.type));
  return functions
    .map((node) => ({
      name: inferFunctionName(node, file.source),
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
      text: node.text,
      nodeType: node.type,
      node
    }))
    .filter((fn) => fn.name !== "<anonymous>");
}

function isFunctionNode(language: ParsedFile["language"], nodeType: string): boolean {
  if (language === "javascript" || language === "typescript") return jsFunctionTypes.has(nodeType);
  if (language === "python") return pythonFunctionTypes.has(nodeType);
  if (language === "go") return goFunctionTypes.has(nodeType);
  if (language === "ruby") return rubyFunctionTypes.has(nodeType);
  if (language === "java") return javaFunctionTypes.has(nodeType);
  if (language === "csharp") return csharpFunctionTypes.has(nodeType);
  if (language === "rust") return rustFunctionTypes.has(nodeType);
  if (language === "php") return phpFunctionTypes.has(nodeType);
  return false;
}

function inferFunctionName(node: TreeSitterNode, source: string): string {
  const nameChild = node.childForFieldName("name");
  if (nameChild?.text) return nameChild.text;

  const parent = node.parent;
  if (!parent) return "<anonymous>";

  const parentText = source.slice(parent.startIndex, Math.min(parent.endIndex, node.startIndex + 120));
  const assignment = parentText.match(/(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
  if (assignment) return assignment[1] ?? "<anonymous>";

  const property = parentText.match(/([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function|\([^)]*\)|[A-Za-z_$][\w$]*)/);
  if (property) return property[1] ?? "<anonymous>";

  return "<anonymous>";
}

function extractFunctionsFallback(file: ParsedFile): FunctionLike[] {
  const patterns: Array<{ regex: RegExp; body: "brace" | "indent" | "ruby" }> = [
    { regex: /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g, body: "brace" },
    { regex: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g, body: "brace" },
    { regex: /\bdef\s+([A-Za-z_]\w*)\s*\(/g, body: "indent" },
    { regex: /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g, body: "brace" },
    { regex: /^\s*def\s+([A-Za-z_]\w*[!?=]?)\s*/gm, body: "ruby" },
    { regex: /\bfn\s+([A-Za-z_]\w*)\s*[(<]/g, body: "brace" }
  ];

  const functions: FunctionLike[] = [];
  for (const pattern of patterns) {
    for (const match of file.source.matchAll(pattern.regex)) {
      const name = match[1];
      if (!name || match.index === undefined) continue;
      const lineStart = lineForIndex(file.source, match.index);
      const text = extractFallbackBody(file.source, match.index, pattern.body);
      functions.push({
        name,
        lineStart,
        lineEnd: lineStart + Math.max(0, text.split(/\r\n|\r|\n/).length - 1),
        text,
        nodeType: "fallback_function"
      });
    }
  }
  return dedupeBy(functions, (fn) => `${fn.name}:${fn.lineStart}`);
}

function extractFallbackBody(source: string, startIndex: number, mode: "brace" | "indent" | "ruby"): string {
  if (mode === "brace") return extractBraceBody(source, startIndex);
  if (mode === "indent") return extractIndentedBody(source, startIndex);
  return extractRubyBody(source, startIndex);
}

function extractBraceBody(source: string, startIndex: number): string {
  const braceStart = source.indexOf("{", startIndex);
  if (braceStart < 0) return source.slice(startIndex, nextLineIndex(source, startIndex));
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(startIndex, index + 1);
  }
  return source.slice(startIndex, Math.min(source.length, braceStart + 4000));
}

function extractIndentedBody(source: string, startIndex: number): string {
  const lines = source.slice(startIndex).split(/\r\n|\r|\n/);
  const firstLine = lines[0] ?? "";
  const baseIndent = firstLine.match(/^\s*/)?.[0].length ?? 0;
  const body: string[] = [firstLine];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      body.push(line);
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= baseIndent) break;
    body.push(line);
  }
  return body.join("\n");
}

function extractRubyBody(source: string, startIndex: number): string {
  const lines = source.slice(startIndex).split(/\r\n|\r|\n/);
  const body: string[] = [];
  let depth = 0;
  for (const line of lines) {
    body.push(line);
    if (/^\s*def\b/.test(line) || /\b(do|class|module|if|unless|case|begin)\b/.test(line)) depth += 1;
    if (/^\s*end\s*$/.test(line)) depth -= 1;
    if (depth <= 0 && body.length > 1) break;
  }
  return body.join("\n");
}

function nextLineIndex(source: string, startIndex: number): number {
  const next = source.indexOf("\n", startIndex);
  return next < 0 ? source.length : next;
}
