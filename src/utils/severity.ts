import type { Severity } from "../types.js";

const order: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2
};

export function severityFromFrequency(frequency: number, blastRadius: number): Severity {
  const score = frequency * Math.log2(Math.max(2, blastRadius + 1));
  if (score >= 2.4 || frequency >= 0.9 && blastRadius >= 4) return "high";
  if (score >= 1.35 || frequency >= 0.8 && blastRadius >= 2) return "medium";
  return "low";
}

export function severityAtLeast(value: Severity, threshold: Severity): boolean {
  return order[value] >= order[threshold];
}

export function normalizeThreshold(value: string): Severity {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error(`Invalid severity threshold "${value}". Expected low, medium, or high.`);
}
