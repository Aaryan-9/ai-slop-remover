// slop-ignore-file -- the phrase and mock-data tables below would otherwise flag themselves.
import type { Detector, Finding, ParsedFile } from "../types.js";
import { extractFunctions, type FunctionLike } from "../ast.js";
import { isApplicationCode, isTestFile } from "../utils/fileKinds.js";
import { clampSnippet, lineForIndex } from "../utils/text.js";
import { slopFinding } from "./common.js";

const CATEGORY = "placeholder";

const placeholderPhrases: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /in a real (implementation|app|application|world|system|project|scenario)/i, label: "in a real implementation" },
  { pattern: /in production,? you (would|should|might)/i, label: "in production you would" },
  { pattern: /this is (just )?a (placeholder|simplified|mock|dummy|stub)/i, label: "declared placeholder" },
  { pattern: /placeholder (implementation|logic|value|for now)/i, label: "declared placeholder" },
  { pattern: /(replace|update) (this )?with (your|the real|actual)/i, label: "replace-with-your marker" },
  { pattern: /your (api[-_ ]?key|logic|code|implementation|token) (goes )?here/i, label: "your-X-here marker" },
  { pattern: /(logic|implementation|code) goes here/i, label: "logic-goes-here marker" },
  { pattern: /for (demonstration|illustration) purposes/i, label: "demonstration-only marker" },
  { pattern: /simplified for (brevity|clarity|this example)/i, label: "simplified-for-brevity marker" },
  { pattern: /for now,? (we|just|it|this) /i, label: "for-now marker" },
  { pattern: /would (normally|typically|usually) (call|fetch|save|query|send)/i, label: "would-normally marker" }
];

const notImplementedBodies: Partial<Record<ParsedFile["language"], RegExp>> = {
  javascript: /^throw new Error\s*\(\s*["'`](?:not (?:yet )?implemented|todo|unimplemented)/i,
  typescript: /^throw new Error\s*\(\s*["'`](?:not (?:yet )?implemented|todo|unimplemented)/i,
  // Bare UnsupportedOperationException is an established Java API contract
  // (utility-class guards, optional operations); only a not-implemented
  // message marks it as unfinished work.
  java: /^throw new UnsupportedOperationException\s*\(\s*"(?:not (?:yet )?implemented|todo|unimplemented)/i,
  csharp: /^throw new NotImplementedException\b/,
  rust: /^(?:todo!|unimplemented!)\s*\(/,
  php: /^throw new \\?(?:\w*Exception)\s*\(\s*["'](?:not (?:yet )?implemented|todo|unimplemented)/i
};
const mockValues: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(john|jane) doe\b/i, label: "placeholder person name" },
  { pattern: /\blorem ipsum\b/i, label: "lorem ipsum text" },
  { pattern: /\btest@(test|example)\.com\b/i, label: "placeholder email" },
  { pattern: /\b(changeme|change-me|s3cr3t|hunter2)\b/i, label: "placeholder secret" }
];

export const placeholdersDetector: Detector = {
  id: "placeholder",
  displayName: "Placeholder / fake-done code",
  run({ files }) {
    const findings: Finding[] = [];
    for (const file of files) {
      if (isTestFile(file.relativePath)) continue;
      findings.push(...phraseFindings(file));
      findings.push(...stubFunctionFindings(file));
      if (isApplicationCode(file.relativePath)) findings.push(...mockValueFindings(file));
    }
    return findings;
  }
};

function phraseFindings(file: ParsedFile): Finding[] {
  const findings: Finding[] = [];
  const lines = file.source.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const hit = placeholderPhrases.find(({ pattern }) => pattern.test(line));
    if (!hit) continue;
    findings.push(slopFinding({
      category: CATEGORY,
      title: "Placeholder language left in code",
      file: file.relativePath,
      lineStart: index + 1,
      lineEnd: index + 1,
      observed: hit.label,
      expected: "finished behavior, or an explicit tracked TODO",
      severity: "medium",
      confidence: 0.9,
      fixHint: "Implement the real behavior here, or delete the stub and track the gap in an issue; do not ship placeholder wording.",
      evidence: clampSnippet(line.trim(), 120),
      explanation: `Line ${index + 1} says "${clampSnippet(line.trim(), 60)}" — language that means the surrounding code was generated as an example, not finished.`
    }));
  }
  return findings;
}

function stubFunctionFindings(file: ParsedFile): Finding[] {
  const findings: Finding[] = [];
  for (const fn of extractFunctions(file)) {
    // Empty or guard-throwing constructors are intentional (private utility
    // classes, no-op default constructors).
    if (fn.nodeType === "constructor_declaration") continue;
    const body = functionBody(fn, file);
    if (body === undefined) continue;
    const stub = classifyStub(body, file.language);
    if (!stub) continue;
    if (fn.name.length <= 4 || /^(noop|stub|mock|dummy|_)/i.test(fn.name)) continue;

    findings.push(slopFinding({
      category: CATEGORY,
      title: "Function is an unimplemented stub",
      file: file.relativePath,
      lineStart: fn.lineStart,
      lineEnd: fn.lineEnd,
      observed: stub.label,
      expected: "a working implementation",
      severity: stub.severity,
      confidence: stub.confidence,
      fixHint: `Implement ${fn.name} or remove it; a named function with ${stub.label} reads as done while doing nothing.`,
      evidence: clampSnippet(fn.text, 120),
      explanation: `${fn.name} looks finished from the call site but its body is ${stub.label}.`
    }));
  }
  return findings;
}

interface StubKind {
  label: string;
  severity: Finding["severity"];
  confidence: number;
}

function classifyStub(body: string, language: ParsedFile["language"]): StubKind | undefined {
  const statements = body
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("#") && !line.startsWith("*") && !line.startsWith("/*"));

  if (language === "python") {
    if (statements.length === 1 && statements[0] === "pass") {
      return { label: "only `pass`", severity: "medium", confidence: 0.8 };
    }
    if (statements.length === 1 && /^raise NotImplementedError/.test(statements[0] ?? "")) {
      return { label: "`raise NotImplementedError`", severity: "high", confidence: 0.85 };
    }
    return undefined;
  }

  const notImplemented = notImplementedBodies[language];
  if (statements.length === 1 && notImplemented?.test(statements[0] ?? "")) {
    return { label: "a not-implemented throw", severity: "high", confidence: 0.85 };
  }
  if (statements.length === 0) {
    const hadComments = /(^|\n)\s*(\/\/|#)/.test(body);
    return {
      label: hadComments ? "an empty body holding only comments" : "an empty body",
      severity: "medium",
      confidence: hadComments ? 0.8 : 0.6
    };
  }
  return undefined;
}

function functionBody(fn: FunctionLike, file: ParsedFile): string | undefined {
  if (file.language === "python") {
    const lines = fn.text.split(/\r\n|\r|\n/);
    const defIndex = lines.findIndex((line) => /^\s*(async\s+)?def\b/.test(line));
    if (defIndex < 0) return undefined;
    return lines.slice(defIndex + 1).join("\n");
  }
  const open = fn.text.indexOf("{");
  const close = fn.text.lastIndexOf("}");
  if (open < 0 || close <= open) return undefined;
  return fn.text.slice(open + 1, close);
}

function mockValueFindings(file: ParsedFile): Finding[] {
  const findings: Finding[] = [];
  for (const { pattern, label } of mockValues) {
    const match = file.source.match(pattern);
    if (!match || match.index === undefined) continue;
    const line = lineForIndex(file.source, match.index);
    findings.push(slopFinding({
      category: CATEGORY,
      title: "Placeholder data in application code",
      file: file.relativePath,
      lineStart: line,
      lineEnd: line,
      observed: label,
      expected: "real data or fixtures kept in test/seed files",
      severity: "low",
      confidence: 0.5,
      fixHint: `Replace the ${label} ("${match[0]}") with real data, or move it into a test/seed file.`,
      evidence: match[0],
      explanation: `Application code contains ${label} ("${match[0]}"), typical of generated example code that was never wired to real data.`
    }));
  }
  return findings;
}
