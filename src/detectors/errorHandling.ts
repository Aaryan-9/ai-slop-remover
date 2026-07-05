import type { Detector, ParsedFile } from "../types.js";
import { extractFunctions, findNodes, type FunctionLike } from "../ast.js";
import { isTestFile } from "../utils/fileKinds.js";
import { directoryBucket } from "../utils/paths.js";
import { clampSnippet } from "../utils/text.js";
import { findingsFromDominantPattern, type Observation } from "./common.js";

export const errorHandlingDetector: Detector = {
  id: "error_handling",
  displayName: "Error handling drift",
  run({ files }) {
    const observations: Observation[] = [];
    for (const file of files) {
      if (isTestFile(file.relativePath)) continue;
      for (const fn of extractFunctions(file)) {
        const pattern = fn.node ? classifyFromAst(fn, file) : classifyFromText(fn.text, file);
        if (!pattern) continue;
        observations.push({
          file,
          lineStart: fn.lineStart,
          lineEnd: fn.lineEnd,
          pattern,
          group: directoryBucket(file.relativePath),
          titleSubject: `Function ${fn.name}`,
          evidence: clampSnippet(fn.text)
        });
      }
    }

    return findingsFromDominantPattern(
      "error_handling",
      "Error handling style differs from nearby code",
      observations,
      4,
      0.8,
      (observation, dominant) => `Rewrite the error path of this function to use ${dominant}, matching the surrounding code, without changing its success behavior.`
    );
  }
};

const resultReturn = /^return\s+(?:ok|err|Ok|Err|Result\.|Either\.|left|right|Left|Right)\s*[(.]/;
const tupleReturn = /^return\s*\[\s*(?:err|error|null|undefined)\s*,/;
const errorFirstCall = /^(?:callback|cb|done|next)\s*\(\s*(?:err|error|new\s+\w*Error)/;

function classifyFromAst(fn: FunctionLike, file: ParsedFile): string | undefined {
  const root = fn.node;
  if (!root) return undefined;

  if (file.language === "python") {
    return findNodes(root, (node) => node.type === "raise_statement").length > 0 ? "exception raise" : undefined;
  }
  if (file.language === "ruby") {
    return /(^|\s)raise\b/.test(fn.text) ? "exception raise" : undefined;
  }
  if (file.language === "go") {
    if (/\bif\s+err\s*!=\s*nil\b/.test(fn.text) || /\breturn\s+[^,\n]+,\s*err\b/.test(fn.text)) return "error return value";
    return undefined;
  }
  if (file.language === "java" || file.language === "csharp" || file.language === "php") {
    const throws = findNodes(root, (node) => node.type === "throw_statement" || node.type === "throw_expression");
    return throws.length > 0 ? "exception throw" : undefined;
  }
  if (file.language === "rust") {
    return classifyRust(fn.text);
  }

  for (const statement of findNodes(root, (node) => node.type === "return_statement")) {
    const text = statement.text.trim();
    if (resultReturn.test(text)) return "Result/Either return";
    if (tupleReturn.test(text)) return "[err, data] tuple";
  }
  for (const call of findNodes(root, (node) => node.type === "call_expression")) {
    if (errorFirstCall.test(call.text)) return "error-first callback";
  }
  if (findNodes(root, (node) => node.type === "throw_statement").length > 0) return "exception throw";
  return undefined;
}

/**
 * Rust error style: a function that only unwraps, in a module where everything
 * else propagates with `?`, is the drift agents introduce. Lock/channel
 * unwraps are idioms, and functions that also use `?` made a considered
 * choice, so neither counts as panic-style.
 */
function classifyRust(source: string): string | undefined {
  const withoutIdioms = source.replace(/\.(?:lock|read|write|borrow(?:_mut)?|recv|join)\(\)\s*\.\s*(?:unwrap\(\)|expect\()/g, "");
  const propagates = /->\s*(?:anyhow::|std::io::)?Result\s*</.test(source)
    || /\breturn\s+(?:Ok|Err)\s*\(|(?:\)|\w)\?\s*[;.)]/.test(source);
  if (propagates) return "Result propagation";
  if (/\.unwrap\(\)|\.expect\(|\bpanic!\s*\(/.test(withoutIdioms)) return "panic/unwrap";
  return undefined;
}

function classifyFromText(source: string, file: ParsedFile): string | undefined {
  if (file.language === "python") return /\braise\s+\w+/.test(source) ? "exception raise" : undefined;
  if (file.language === "ruby") return /(^|\s)raise\b/.test(source) ? "exception raise" : undefined;
  if (file.language === "go") {
    return /\bif\s+err\s*!=\s*nil\b|\breturn\s+[^,\n]+,\s*err\b/.test(source) ? "error return value" : undefined;
  }
  if (file.language === "java" || file.language === "csharp" || file.language === "php") {
    return /\bthrow\s+new\s+\w+/.test(source) ? "exception throw" : undefined;
  }
  if (file.language === "rust") return classifyRust(source);
  if (/\breturn\s+(?:ok|err|Ok|Err)\s*\(/.test(source)) return "Result/Either return";
  if (/\breturn\s*\[\s*(?:err|error|null|undefined)\s*,/.test(source)) return "[err, data] tuple";
  if (/\b(?:callback|cb|done)\s*\(\s*(?:err|error)\b/.test(source)) return "error-first callback";
  if (/\bthrow\s+(?:new\s+)?\w+/.test(source)) return "exception throw";
  return undefined;
}
