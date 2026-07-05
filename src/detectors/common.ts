import type { Finding, ParsedFile } from "../types.js";
import { countBy, groupBy, roundTo } from "../utils/collections.js";
import { severityFromFrequency } from "../utils/severity.js";
import { percent } from "../utils/text.js";

export interface Observation {
  file: ParsedFile;
  lineStart: number;
  lineEnd: number;
  pattern: string;
  group: string;
  titleSubject: string;
  evidence?: string;
}

export function findingsFromDominantPattern(
  category: string,
  title: string,
  observations: Observation[],
  minimumGroupSize: number,
  minimumDominance = 0.8,
  fixHintFor: (observation: Observation, dominantPattern: string) => string = defaultFixHint
): Finding[] {
  const groups = groupBy(observations, (observation) => observation.group);

  const findings: Finding[] = [];
  for (const [group, groupObservations] of groups) {
    if (groupObservations.length < minimumGroupSize) continue;
    const counts = countBy(groupObservations.map((item) => item.pattern));
    const [dominantPattern, dominantCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!dominantPattern || !dominantCount) continue;
    const frequency = dominantCount / groupObservations.length;
    if (frequency < minimumDominance) continue;

    for (const observation of groupObservations) {
      if (observation.pattern === dominantPattern) continue;
      findings.push({
        category,
        title,
        file: observation.file.relativePath,
        line_start: observation.lineStart,
        line_end: observation.lineEnd,
        pattern_observed: observation.pattern,
        dominant_pattern: dominantPattern,
        dominant_frequency: frequency,
        severity: severityFromFrequency(frequency, groupObservations.length),
        confidence: driftConfidence(frequency, groupObservations.length),
        fix_hint: fixHintFor(observation, dominantPattern),
        group,
        evidence: observation.evidence,
        explanation: `${observation.titleSubject} uses ${observation.pattern}, while ${percent(frequency)} of comparable code in ${group} uses ${dominantPattern}.`
      });
    }
  }

  return findings;
}

export interface SlopFindingInput {
  category: string;
  title: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  observed: string;
  expected: string;
  severity: Finding["severity"];
  confidence: number;
  fixHint: string;
  explanation: string;
  evidence?: string;
}

/** Builds a finding for an absolute slop rule (no repo-relative dominant pattern). */
export function slopFinding(input: SlopFindingInput): Finding {
  return {
    category: input.category,
    title: input.title,
    file: input.file,
    line_start: input.lineStart,
    line_end: input.lineEnd,
    pattern_observed: input.observed,
    dominant_pattern: input.expected,
    dominant_frequency: 1,
    severity: input.severity,
    confidence: input.confidence,
    fix_hint: input.fixHint,
    evidence: input.evidence,
    explanation: input.explanation
  };
}

export function driftConfidence(frequency: number, groupSize: number): number {
  const sampleWeight = 0.5 + 0.5 * Math.min(1, groupSize / 10);
  return roundTo(Math.min(0.95, frequency * sampleWeight), 2);
}

function defaultFixHint(observation: Observation, dominantPattern: string): string {
  return `Rewrite so it follows the dominant local pattern (${dominantPattern}) instead of ${observation.pattern}, without changing behavior.`;
}
