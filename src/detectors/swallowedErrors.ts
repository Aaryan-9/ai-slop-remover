import type { Detector, Finding, LanguageId, ParsedFile, TreeSitterNode } from "../types.js";
import { findNodes } from "../ast.js";
import { isTestFile } from "../utils/fileKinds.js";
import { clampSnippet, lineForIndex } from "../utils/text.js";
import { slopFinding } from "./common.js";

const CATEGORY = "swallowed_errors";

interface CatchConfig {
  bodyType: string;
  /** Expression statements that merely report and move on. */
  quietCall: RegExp;
  /** Anything that means the error is genuinely handled or propagated. */
  handled: RegExp;
}

const catchConfigs: Partial<Record<LanguageId, CatchConfig>> = {
  javascript: {
    bodyType: "statement_block",
    quietCall: /^console\.(log|warn|error|info|debug)\b/,
    handled: /\b(throw|reject|next\s*\(|process\.exit|res\.(status|send|json)|logger\.|captureException|rollback)\b/
  },
  java: {
    bodyType: "block",
    quietCall: /printStackTrace|^System\.(out|err)\.print/,
    handled: /\bthrow\b|logger\.|log\.(error|warn|info)|LOG(GER)?\.|rollback/i
  },
  csharp: {
    bodyType: "block",
    quietCall: /^Console\.(Write|Error)/,
    handled: /\bthrow\b|_?logger\.|Log(ger)?\.|rollback/i
  },
  php: {
    bodyType: "compound_statement",
    quietCall: /^(echo|error_log|var_dump|print_r|print)\b/,
    handled: /\bthrow\b|->(error|critical|alert|emergency)\(/
  }
};
catchConfigs.typescript = catchConfigs.javascript;

const quietReturn = /^return\s*(null|undefined|false|nil|default(\(\w*\))?|\[\s*\]|\{\s*\})?\s*;?$/;

export const swallowedErrorsDetector: Detector = {
  id: "swallowed_errors",
  displayName: "Swallowed errors",
  run({ files }) {
    const findings: Finding[] = [];
    for (const file of files) {
      if (isTestFile(file.relativePath)) continue;
      const config = catchConfigs[file.language];
      if (config) {
        findings.push(...(file.rootNode ? catchClauseFindings(file, config) : emptyCatchFallbackFindings(file)));
      } else if (file.language === "python" && file.rootNode) {
        findings.push(...pythonFindings(file));
      } else if (file.language === "go") {
        findings.push(...goFindings(file));
      }
    }
    return findings;
  }
};

function catchClauseFindings(file: ParsedFile, config: CatchConfig): Finding[] {
  const findings: Finding[] = [];
  for (const clause of findNodes(file.rootNode, (node) => node.type === "catch_clause")) {
    const body = childOfType(clause, config.bodyType);
    if (!body) continue;
    const children = namedChildren(body);
    const statements = children.filter((node) => node.type !== "comment");
    // A comment inside the catch is a human explaining why swallowing is
    // safe — exactly what the fix hint asks for — so don't flag it.
    const justified = children.length > statements.length;

    if (statements.length === 0) {
      if (justified) continue;
      findings.push(swallowFinding(file, clause, "empty catch block", 0.9,
        "The catch block is empty: the error disappears and callers see success."));
      continue;
    }

    const isQuiet = (node: TreeSitterNode): boolean => {
      const text = node.text.trim();
      if (node.type === "expression_statement") return config.quietCall.test(text);
      if (node.type === "return_statement") return quietReturn.test(text);
      return node.type === "continue_statement" || node.type === "break_statement";
    };

    if (!justified && statements.every(isQuiet) && !statements.some((node) => config.handled.test(node.text))) {
      findings.push(swallowFinding(file, clause, "catch that logs and swallows", 0.7,
        "The catch block only logs (or returns a silent default), so failures look like successes to callers."));
    }
  }
  return findings;
}

function emptyCatchFallbackFindings(file: ParsedFile): Finding[] {
  const findings: Finding[] = [];
  for (const match of file.source.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)) {
    if (match.index === undefined) continue;
    const line = lineForIndex(file.source, match.index);
    findings.push(slopFinding({
      category: CATEGORY,
      title: "Error swallowed silently",
      file: file.relativePath,
      lineStart: line,
      lineEnd: line,
      observed: "empty catch block",
      expected: "errors rethrown, returned, or explicitly justified",
      severity: "medium",
      confidence: 0.9,
      fixHint: "Handle the error: rethrow it, return an error result, or add a comment justifying why ignoring it is safe.",
      evidence: clampSnippet(match[0], 120),
      explanation: "The catch block is empty: the error disappears and callers see success."
    }));
  }
  return findings;
}

function pythonFindings(file: ParsedFile): Finding[] {
  const findings: Finding[] = [];
  for (const clause of findNodes(file.rootNode, (node) => node.type === "except_clause")) {
    const header = clause.text.split(/\r\n|\r|\n/)[0]?.trim() ?? "";
    const body = childOfType(clause, "block");
    const bodyChildren = body ? namedChildren(body) : [];
    const bodyStatements = bodyChildren.filter((node) => node.type !== "comment");
    const justified = bodyChildren.length > bodyStatements.length;
    const passOnly = bodyStatements.length === 1 && bodyStatements[0]!.type === "pass_statement";
    const bare = /^except\s*:/.test(header);
    const broad = /^except\s+(Exception|BaseException)\b[^:]*:/.test(header);

    if (passOnly && (bare || broad) && !justified) {
      findings.push(swallowFinding(file, clause, "except-and-pass", 0.9,
        "Every exception is silently discarded; failures in this block are invisible."));
    } else if (bare) {
      findings.push(swallowFinding(file, clause, "bare except", 0.8,
        "A bare `except:` also catches SystemExit and KeyboardInterrupt and hides real failures."));
    }
  }
  return findings;
}

function goFindings(file: ParsedFile): Finding[] {
  const findings: Finding[] = [];

  if (file.rootNode) {
    for (const statement of findNodes(file.rootNode, (node) => node.type === "if_statement")) {
      const condition = statement.childForFieldName("condition");
      if (!condition || !/err\s*!=\s*nil/.test(condition.text)) continue;
      const consequence = statement.childForFieldName("consequence");
      if (!consequence) continue;
      const children = namedChildren(consequence);
      const statements = children.filter((node) => node.type !== "comment");
      const justified = children.length > statements.length;
      if (statements.length === 0 && !justified) {
        findings.push(swallowFinding(file, statement, "empty `if err != nil` block", 0.9,
          "The error is checked and then ignored: the branch does nothing and execution continues as if it succeeded."));
      }
    }
  } else {
    for (const match of file.source.matchAll(/if\s+err\s*!=\s*nil\s*\{\s*\}/g)) {
      if (match.index === undefined) continue;
      const line = lineForIndex(file.source, match.index);
      findings.push(swallowLineFinding(file, line, "empty `if err != nil` block", 0.9,
        "The error is checked and then ignored: the branch does nothing and execution continues as if it succeeded.",
        clampSnippet(match[0], 120)));
    }
  }

  for (const match of file.source.matchAll(/^[ \t]*_\s*=\s*err\b.*$/gm)) {
    if (match.index === undefined) continue;
    const line = lineForIndex(file.source, match.index);
    findings.push(swallowLineFinding(file, line, "error assigned to blank identifier", 0.85,
      "Assigning the error to `_` deliberately discards it; callers cannot tell the operation failed.",
      clampSnippet(match[0].trim(), 120)));
  }

  return findings;
}

function swallowFinding(file: ParsedFile, node: TreeSitterNode, observed: string, confidence: number, explanation: string): Finding {
  return slopFinding({
    category: CATEGORY,
    title: "Error swallowed silently",
    file: file.relativePath,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
    observed,
    expected: "errors rethrown, returned, or explicitly justified",
    severity: "medium",
    confidence,
    fixHint: "Handle the error: rethrow it, return an error result, or add a comment justifying why ignoring it is safe.",
    evidence: clampSnippet(node.text, 120),
    explanation
  });
}

function swallowLineFinding(file: ParsedFile, line: number, observed: string, confidence: number, explanation: string, evidence: string): Finding {
  return slopFinding({
    category: CATEGORY,
    title: "Error swallowed silently",
    file: file.relativePath,
    lineStart: line,
    lineEnd: line,
    observed,
    expected: "errors rethrown, returned, or explicitly justified",
    severity: "medium",
    confidence,
    fixHint: "Handle the error: rethrow it, return an error result, or add a comment justifying why ignoring it is safe.",
    evidence,
    explanation
  });
}

function childOfType(node: TreeSitterNode, type: string): TreeSitterNode | undefined {
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (child?.type === type) return child;
  }
  return undefined;
}

function namedChildren(node: TreeSitterNode): TreeSitterNode[] {
  const children: TreeSitterNode[] = [];
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (child) children.push(child);
  }
  return children;
}
