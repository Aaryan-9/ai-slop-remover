import type { Detector, Finding, ParsedFile } from "../types.js";
import { commentRuns, extractComments, type CommentSpan } from "../comments.js";
import { isTestFile } from "../utils/fileKinds.js";
import { clampSnippet } from "../utils/text.js";
import { slopFinding } from "./common.js";

const CATEGORY = "comment_slop";

const keepMarkers = /\b(todo|fixme|hack|note|nb|warning|why|because|workaround|see|eslint|ts-ignore|ts-expect-error|ts-nocheck|noqa|rubocop|nolint|license|copyright|spdx|biome-ignore|prettier-ignore|istanbul|c8|v8)\b|https?:\/\/|\?/i;
const stepNarration = /^(step\s*\d+|first|second|third|next|then|finally|lastly|now,)\b[\s,:.–-]/i;
const emojiPattern = /[\u{1F300}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}]/u;
const stopwords = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are", "be", "we", "it",
  "this", "that", "with", "from", "into", "if", "when", "then", "our", "all", "each", "new", "using"
]);

export const commentSlopDetector: Detector = {
  id: "comment_slop",
  displayName: "Comment slop",
  run({ files }) {
    const findings: Finding[] = [];
    for (const file of files) {
      if (isTestFile(file.relativePath)) continue;
      const comments = extractComments(file).filter((comment) => !comment.isDoc && comment.content.length > 0);
      const lines = file.source.split(/\r\n|\r|\n/);

      findings.push(...redundantCommentFindings(file, comments, lines));
      findings.push(...bannerFindings(file, comments));
      findings.push(...stepNarrationFindings(file, comments));
      const emoji = emojiFinding(file, comments, lines);
      if (emoji) findings.push(emoji);
    }
    return findings;
  }
};

function redundantCommentFindings(file: ParsedFile, comments: CommentSpan[], lines: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const comment of comments) {
    if (comment.lineStart !== comment.lineEnd) continue;
    if (comment.content.length > 90 || keepMarkers.test(comment.content)) continue;
    const ownLine = lines[comment.lineStart - 1] ?? "";
    if (!ownLine.trim().startsWith(comment.text.slice(0, 2))) continue;

    const codeLine = nextCodeLine(lines, comment.lineEnd);
    if (!codeLine) continue;

    const commentWords = contentWords(comment.content);
    if (commentWords.length < 2) continue;
    const codeWords = identifierWords(codeLine.text);
    const matched = commentWords.filter((word) => codeWords.has(word));
    const overlap = matched.length / commentWords.length;
    if (overlap < 0.6) continue;

    findings.push(slopFinding({
      category: CATEGORY,
      title: "Comment restates the code below it",
      file: file.relativePath,
      lineStart: comment.lineStart,
      lineEnd: comment.lineEnd,
      observed: "narrative comment duplicating the code",
      expected: "self-explanatory code without narration",
      severity: "low",
      confidence: Math.min(0.9, 0.5 + overlap * 0.4),
      fixHint: "Delete this comment; it repeats what the next line already says.",
      evidence: clampSnippet(`${comment.text} → ${codeLine.text.trim()}`),
      explanation: `The comment "${clampSnippet(comment.content, 60)}" repeats the identifiers of the code on line ${codeLine.line}; it adds no information.`
    }));
  }
  return findings;
}

function bannerFindings(file: ParsedFile, comments: CommentSpan[]): Finding[] {
  const findings: Finding[] = [];
  for (const comment of comments) {
    if (!/[=\-*#~_]{4,}/.test(comment.content)) continue;
    const decoration = (comment.content.match(/[=\-*#~_]/g) ?? []).length;
    if (decoration / Math.max(1, comment.content.length) < 0.3) continue;

    findings.push(slopFinding({
      category: CATEGORY,
      title: "Decorative banner comment",
      file: file.relativePath,
      lineStart: comment.lineStart,
      lineEnd: comment.lineEnd,
      observed: "ASCII-art section banner",
      expected: "structure expressed with functions/modules, not banners",
      severity: "low",
      confidence: 0.8,
      fixHint: "Delete this banner comment; if the section is worth naming, extract it into a well-named function or module.",
      evidence: clampSnippet(comment.text, 80),
      explanation: "Section banners are decoration, not documentation; they are a common tell of generated code."
    }));
  }
  return findings;
}

function stepNarrationFindings(file: ParsedFile, comments: CommentSpan[]): Finding[] {
  const narrated = comments.filter((comment) => stepNarration.test(comment.content));
  if (narrated.length < 2) return [];
  return narrated.map((comment) => slopFinding({
    category: CATEGORY,
    title: "Step-by-step narration comment",
    file: file.relativePath,
    lineStart: comment.lineStart,
    lineEnd: comment.lineEnd,
    observed: "tutorial-style step narration",
    expected: "code order conveys sequence on its own",
    severity: "low",
    confidence: 0.7,
    fixHint: "Remove the step-narration comments; the statement order already conveys the sequence.",
    evidence: clampSnippet(comment.text, 80),
    explanation: `This file narrates its own control flow in ${narrated.length} comments ("Step 1", "First", "Finally"), which is prompt-transcript style rather than documentation.`
  }));
}

function emojiFinding(file: ParsedFile, comments: CommentSpan[], lines: string[]): Finding | undefined {
  const commentHits = comments.filter((comment) => emojiPattern.test(comment.content));
  const logHits: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/(\b(console\.(log|info|warn|error)|print|puts|fmt\.Print|System\.(out|err)\.print|Console\.Write|e?println!)\w*\s*\(|\becho\s+["'(])/.test(line) && emojiPattern.test(line)) {
      logHits.push(index + 1);
    }
  }
  const total = commentHits.length + logHits.length;
  if (total === 0) return undefined;

  const firstLine = Math.min(...commentHits.map((comment) => comment.lineStart), ...(logHits.length > 0 ? [logHits[0]!] : []));
  return slopFinding({
    category: CATEGORY,
    title: "Emoji in comments or log output",
    file: file.relativePath,
    lineStart: firstLine,
    lineEnd: firstLine,
    observed: `emoji on ${total} line(s)`,
    expected: "plain-text comments and log messages",
    severity: "low",
    confidence: 0.8,
    fixHint: `Remove emoji from comments and log strings in this file (${total} occurrence(s), first at line ${firstLine}).`,
    explanation: "Emoji in comments and log statements (✅ 🚀 🎉) is a strong signature of unedited AI-generated code."
  });
}

function nextCodeLine(lines: string[], afterLine: number): { line: number; text: string } | undefined {
  for (let index = afterLine; index < Math.min(lines.length, afterLine + 3); index += 1) {
    const text = lines[index] ?? "";
    const trimmed = text.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return undefined;
    return { line: index + 1, text };
  }
  return undefined;
}

function contentWords(content: string): string[] {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !stopwords.has(word));
}

function identifierWords(codeLine: string): Set<string> {
  const words = new Set<string>();
  for (const identifier of codeLine.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    words.add(identifier.toLowerCase());
    for (const part of identifier.split(/(?=[A-Z])|_/)) {
      const clean = part.toLowerCase();
      if (clean.length > 1) {
        words.add(clean);
        // "users" in code matches "user" in the comment and vice versa.
        if (clean.endsWith("s")) words.add(clean.slice(0, -1));
        else words.add(`${clean}s`);
      }
    }
  }
  return words;
}
