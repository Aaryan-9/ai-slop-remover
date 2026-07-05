import type { ParsedFile } from "./types.js";
import { findNodes } from "./ast.js";
import { lineForIndex } from "./utils/text.js";

export interface CommentSpan {
  /** Raw comment text including markers. */
  text: string;
  /** Comment content with markers stripped and trimmed. */
  content: string;
  lineStart: number;
  lineEnd: number;
  /** True for JSDoc blocks and Python docstrings. */
  isDoc: boolean;
}

export function extractComments(file: ParsedFile): CommentSpan[] {
  if (file.rootNode) return extractFromAst(file);
  return extractFromText(file);
}

function extractFromAst(file: ParsedFile): CommentSpan[] {
  const nodes = findNodes(file.rootNode, (node) => node.type === "comment" || node.type === "block_comment" || node.type === "line_comment");
  return nodes.map((node) => ({
    text: node.text,
    content: stripMarkers(node.text),
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
    isDoc: node.text.startsWith("/**") || node.text.startsWith('"""') || node.text.startsWith("'''")
  }));
}

function extractFromText(file: ParsedFile): CommentSpan[] {
  const comments: CommentSpan[] = [];
  const lineComment = file.language === "python" || file.language === "ruby" ? /(^|[^:'"])#(?!!)(.*)$/ : /(^|[^:'"])\/\/(.*)$/;
  const lines = file.source.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(lineComment);
    if (!match) continue;
    const marker = file.language === "python" || file.language === "ruby" ? "#" : "//";
    const text = `${marker}${match[2] ?? ""}`;
    comments.push({
      text,
      content: stripMarkers(text),
      lineStart: index + 1,
      lineEnd: index + 1,
      isDoc: false
    });
  }

  if (file.language !== "python" && file.language !== "ruby") {
    for (const match of file.source.matchAll(/\/\*[\s\S]*?\*\//g)) {
      if (match.index === undefined) continue;
      comments.push({
        text: match[0],
        content: stripMarkers(match[0]),
        lineStart: lineForIndex(file.source, match.index),
        lineEnd: lineForIndex(file.source, match.index + match[0].length - 1),
        isDoc: match[0].startsWith("/**")
      });
    }
  }

  return comments.sort((a, b) => a.lineStart - b.lineStart);
}

export function stripMarkers(text: string): string {
  return text
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .replace(/^\/\/+/, "")
    .replace(/^#+/, "")
    .replace(/^["']{3}/, "")
    .replace(/["']{3}$/, "")
    .replace(/^\s*\*+\s?/gm, "")
    .trim();
}

/** Groups comments that sit on consecutive lines into runs. */
export function commentRuns(comments: CommentSpan[]): CommentSpan[][] {
  const runs: CommentSpan[][] = [];
  let current: CommentSpan[] = [];
  for (const comment of comments) {
    const previous = current[current.length - 1];
    if (previous && comment.lineStart <= previous.lineEnd + 1) {
      current.push(comment);
    } else {
      if (current.length > 0) runs.push(current);
      current = [comment];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}
