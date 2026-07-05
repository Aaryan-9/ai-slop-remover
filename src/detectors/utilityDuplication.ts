import crypto from "node:crypto";
import type { Detector, Finding } from "../types.js";
import { extractFunctions } from "../ast.js";
import { groupBy } from "../utils/collections.js";
import { isExampleFile, isTestFile } from "../utils/fileKinds.js";
import { severityFromFrequency } from "../utils/severity.js";
import { clampSnippet } from "../utils/text.js";

interface UtilityCandidate {
  file: string;
  lineStart: number;
  lineEnd: number;
  name: string;
  hash: string;
  normalizedShape: string;
  evidence: string;
}

export const utilityDuplicationDetector: Detector = {
  id: "utility_duplication",
  displayName: "Utility duplication",
  run({ files }) {
    const candidates: UtilityCandidate[] = [];
    for (const file of files) {
      if (isTestFile(file.relativePath) || isExampleFile(file.relativePath)) continue;
      for (const fn of extractFunctions(file)) {
        if (!looksLikeSmallUtility(fn.name, fn.text)) continue;
        const normalizedShape = normalizeFunctionShape(fn.text);
        if (normalizedShape.length < 40) continue;
        candidates.push({
          file: file.relativePath,
          lineStart: fn.lineStart,
          lineEnd: fn.lineEnd,
          name: fn.name,
          hash: hash(normalizedShape),
          normalizedShape,
          evidence: clampSnippet(fn.text)
        });
      }
    }

    const byHash = groupBy(candidates, (candidate) => candidate.hash);
    const findings: Finding[] = [];
    for (const duplicates of byHash.values()) {
      const uniqueFiles = new Set(duplicates.map((item) => item.file));
      if (duplicates.length < 2 || uniqueFiles.size < 2) continue;
      const canonical = chooseCanonical(duplicates);
      const frequency = Math.min(0.95, duplicates.length / Math.max(duplicates.length + 1, 3));
      for (const duplicate of duplicates) {
        if (duplicate === canonical) continue;
        findings.push({
          category: "utility_duplication",
          title: "Small utility appears to be reimplemented",
          file: duplicate.file,
          line_start: duplicate.lineStart,
          line_end: duplicate.lineEnd,
          pattern_observed: `local utility ${duplicate.name}`,
          dominant_pattern: `shared candidate ${canonical.name} in ${canonical.file}`,
          dominant_frequency: frequency,
          severity: severityFromFrequency(0.82, duplicates.length),
          confidence: Math.min(0.9, 0.6 + 0.1 * duplicates.length),
          fix_hint: `Extract one shared utility (start from ${canonical.name} in ${canonical.file}), import it here, and delete this copy of ${duplicate.name}.`,
          group: "identifier-normalized utility body",
          evidence: duplicate.evidence,
          explanation: `${duplicate.name} has the same identifier-normalized AST/text shape as ${canonical.name} in ${canonical.file}. Prefer one shared utility if this logic is intentionally common.`
        });
      }
    }

    return findings;
  }
};

function looksLikeSmallUtility(name: string, text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length > 60) return false;
  if (/\b(render|component|controller|route|page|middleware)\b/i.test(name)) return false;
  // (req, res) / (err, req, res, next) signatures are framework handlers
  // wired by convention, not utilities to be shared.
  if (/\(\s*(?:err(?:or)?\s*,\s*)?(?:req|request)\s*,\s*(?:res|response)\b/.test(lines[0] ?? "")) return false;
  // Interface/override implementations (hashCode, toString, size delegation)
  // are contracts that cannot be extracted into a shared utility.
  if (/@Override|\boverride\b/.test(text)) return false;
  // Single-statement wrappers have nothing worth consolidating.
  const braceIndex = text.indexOf("{");
  if (braceIndex >= 0) {
    const statementCount = (text.slice(braceIndex).match(/;/g) ?? []).length;
    if (statementCount < 2) return false;
  } else if (lines.length < 3) {
    return false;
  }
  return /\b(format|parse|slug|debounce|throttle|clone|merge|omit|pick|normalize|sanitize|validate|to[A-Z]|from[A-Z]|is[A-Z]|has[A-Z]|date|string|url|path)\b/.test(name)
    || lines.length <= 18;
}

function normalizeFunctionShape(text: string): string {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/#.*$/gm, "");

  const identifiers = new Map<string, string>();
  let nextId = 1;

  // Numeric literals stay verbatim: two utilities that differ only in a
  // constant (round-to-1 vs round-to-2 decimals) are variants, not copies.
  return withoutComments
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "STRING")
    .replace(/\b[A-Za-z_$][\w$]*\b/g, (identifier) => {
      if (isKeyword(identifier)) return identifier;
      const existing = identifiers.get(identifier);
      if (existing) return existing;
      const normalized = `ID${nextId}`;
      nextId += 1;
      identifiers.set(identifier, normalized);
      return normalized;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function isKeyword(value: string): boolean {
  return new Set([
    "async", "await", "return", "if", "else", "for", "while", "const", "let", "var", "function",
    "def", "class", "in", "of", "try", "catch", "finally", "throw", "raise", "new", "true", "false",
    "nil", "null", "undefined", "switch", "case", "break", "continue", "func", "range"
  ]).has(value);
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function chooseCanonical(candidates: UtilityCandidate[]): UtilityCandidate {
  return [...candidates].sort((a, b) => a.file.localeCompare(b.file) || a.lineStart - b.lineStart)[0] ?? candidates[0]!;
}
