export type LanguageId = "javascript" | "typescript" | "python" | "go" | "ruby" | "java" | "csharp" | "rust" | "php";

export type Severity = "low" | "medium" | "high";

export interface TreeSitterPoint {
  row: number;
  column: number;
}

export interface TreeSitterNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: TreeSitterPoint;
  endPosition: TreeSitterPoint;
  parent: TreeSitterNode | null;
  namedChildCount: number;
  namedChild(index: number): TreeSitterNode | null;
  childForFieldName(name: string): TreeSitterNode | null;
}

export interface TreeSitterTree {
  rootNode: TreeSitterNode;
}

export interface SourceFile {
  absolutePath: string;
  relativePath: string;
  language: LanguageId;
  source: string;
  lineCount: number;
}

export interface ParsedFile extends SourceFile {
  tree?: TreeSitterTree;
  rootNode?: TreeSitterNode;
  parseWarnings: string[];
}

export interface Finding {
  category: string;
  title: string;
  file: string;
  line_start: number;
  line_end: number;
  pattern_observed: string;
  dominant_pattern: string;
  dominant_frequency: number;
  severity: Severity;
  /** 0-1: how likely this finding is real slop rather than intentional code. */
  confidence: number;
  /** Imperative instruction for a human or coding agent applying the fix. */
  fix_hint: string;
  explanation: string;
  group?: string;
  evidence?: string;
}

export interface DetectorContext {
  rootPath: string;
  files: ParsedFile[];
}

export interface Detector {
  id: string;
  displayName: string;
  run(context: DetectorContext): Finding[] | Promise<Finding[]>;
}

export interface ScanOptions {
  excludes: string[];
  severityThreshold: Severity;
  /** Findings whose fingerprint is in this set are suppressed (baseline). */
  baselineFingerprints?: Set<string>;
}

export interface ScanResult {
  rootPath: string;
  files: ParsedFile[];
  findings: Finding[];
  /** Total source lines scanned; the denominator of the Slop Score. */
  totalLines: number;
  score: import("./score.js").ScoreReport;
  baselinedCount: number;
  startedAt: Date;
  completedAt: Date;
  parseWarnings: string[];
}

export type ReportFormat = "terminal" | "md" | "html" | "json" | "both";

export interface CliScanOptions {
  format: ReportFormat;
  output?: string;
  severityThreshold: Severity;
  exclude: string[];
  verbose: boolean;
  check: boolean;
  minScore?: number;
  baseline: boolean;
}
