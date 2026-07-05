import type { Finding, Severity } from "./types.js";
import { groupBy, roundTo } from "./utils/collections.js";

/**
 * Slop Score: 100 minus severity- and confidence-weighted finding density.
 *
 * penalty(category) = min(CATEGORY_CAP, POINTS_PER_DENSITY * weighted / KLOC)
 * weighted = Σ severityWeight * confidence over the category's findings
 *
 * The per-category cap keeps one noisy detector from zeroing the score;
 * the KLOC normalization keeps large repos comparable to small ones.
 */

const severityWeights: Record<Severity, number> = {
  low: 1,
  medium: 3,
  high: 7
};

const POINTS_PER_DENSITY = 3;
const CATEGORY_CAP = 25;

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface CategoryScore {
  category: string;
  findingCount: number;
  weighted: number;
  penalty: number;
}

export interface ScoreReport {
  score: number;
  grade: Grade;
  kloc: number;
  categories: CategoryScore[];
}

export function computeScore(findings: Finding[], totalLines: number): ScoreReport {
  const kloc = Math.max(0.2, totalLines / 1000);
  const categories: CategoryScore[] = [];

  for (const [category, categoryFindings] of groupBy(findings, (finding) => finding.category)) {
    const weighted = categoryFindings.reduce(
      (sum, finding) => sum + severityWeights[finding.severity] * finding.confidence,
      0
    );
    const penalty = Math.min(CATEGORY_CAP, (POINTS_PER_DENSITY * weighted) / kloc);
    categories.push({
      category,
      findingCount: categoryFindings.length,
      weighted: roundTo(weighted, 1),
      penalty: roundTo(penalty, 1)
    });
  }

  categories.sort((a, b) => b.penalty - a.penalty);
  const totalPenalty = categories.reduce((sum, category) => sum + category.penalty, 0);
  const score = Math.max(0, Math.round(100 - totalPenalty));

  return { score, grade: gradeFor(score), kloc: roundTo(kloc, 1), categories };
}

export function gradeFor(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
