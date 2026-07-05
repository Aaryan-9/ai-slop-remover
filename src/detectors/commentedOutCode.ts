import type { Detector, Finding } from "../types.js";
import { commentRuns, extractComments } from "../comments.js";
import { isTestFile } from "../utils/fileKinds.js";
import { clampSnippet } from "../utils/text.js";
import { slopFinding } from "./common.js";

const CATEGORY = "commented_out_code";

const codeLike = [
  /[;{}]\s*$/,
  // A keyword alone can start an English sentence ("if it were above..."),
  // so require code punctuation with it.
  /^\s*(if|else|for|while|switch|return|const|let|var|import|export|def|func|function|class|try|catch|except|elif|await|async)\b.*[({;=:]/,
  /\w+\s*=\s*\S/,
  /\w+\(([^)]*)\)/,
  /^\s*[\])},]/
];
const proseLike = /\b(the|a|an|this|that|should|must|because|when|why|note|todo|fixme|usage|example|would|were|etc|means|instead)\b/i;

export const commentedOutCodeDetector: Detector = {
  id: "commented_out_code",
  displayName: "Commented-out code",
  run({ files }) {
    const findings: Finding[] = [];
    for (const file of files) {
      if (isTestFile(file.relativePath)) continue;
      const comments = extractComments(file).filter((comment) => !comment.isDoc);

      for (const run of commentRuns(comments)) {
        const lines = run
          .flatMap((comment) => comment.content.split(/\r\n|\r|\n/))
          .map((line) => line.trim())
          .filter((line) => line !== "");
        if (lines.length < 3) continue;
        if (/\b(example|usage|@example|license|copyright)\b/i.test(lines[0] ?? "")) continue;

        const codeLines = lines.filter((line) => codeLike.some((pattern) => pattern.test(line)) && !proseLike.test(line));
        const ratio = codeLines.length / lines.length;
        if (ratio < 0.6) continue;

        const first = run[0]!;
        const last = run[run.length - 1]!;
        findings.push(slopFinding({
          category: CATEGORY,
          title: "Block of commented-out code",
          file: file.relativePath,
          lineStart: first.lineStart,
          lineEnd: last.lineEnd,
          observed: `${lines.length} commented-out lines that parse as code`,
          expected: "dead code deleted, not commented out",
          severity: "medium",
          confidence: Math.min(0.9, 0.5 + ratio * 0.4),
          fixHint: `Delete lines ${first.lineStart}-${last.lineEnd}; the code is dead and version control preserves history if it is ever needed.`,
          evidence: clampSnippet(lines.slice(0, 3).join(" ⏎ "), 120),
          explanation: `Lines ${first.lineStart}-${last.lineEnd} are a disabled implementation left behind as comments — a classic leftover of AI-assisted edits.`
        }));
      }
    }
    return findings;
  }
};
