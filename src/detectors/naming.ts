import type { Detector } from "../types.js";
import { extractFunctions } from "../ast.js";
import { isTestFile } from "../utils/fileKinds.js";
import { directoryBucket } from "../utils/paths.js";
import { findingsFromDominantPattern, type Observation } from "./common.js";

const crudPrefixes = ["create", "add", "insert", "get", "fetch", "find", "list", "update", "set", "delete", "remove", "handle", "on"];
const crudSuffixes = ["Create", "Add", "Insert", "Get", "Fetch", "Find", "List", "Update", "Set", "Delete", "Remove", "Handler"];

export const namingDetector: Detector = {
  id: "naming",
  displayName: "Naming convention drift",
  run({ files }) {
    const observations: Observation[] = [];
    for (const file of files) {
      if (isTestFile(file.relativePath)) continue;
      for (const fn of extractFunctions(file)) {
        const bucket = conceptualBucket(fn.name);
        if (!bucket) continue;
        observations.push({
          file,
          lineStart: fn.lineStart,
          lineEnd: fn.lineEnd,
          pattern: namingPattern(fn.name, bucket),
          group: `${directoryBucket(file.relativePath)}:${bucket}`,
          titleSubject: `Function ${fn.name}`,
          evidence: fn.name
        });
      }
    }

    return findingsFromDominantPattern(
      "naming",
      "Function naming differs from the local convention",
      observations,
      5,
      0.75,
      (observation, dominant) => `Rename ${observation.evidence} so it follows the local "${dominant}" naming convention.`
    );
  }
};

function conceptualBucket(name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const prefix of crudPrefixes) {
    if (lower.startsWith(prefix) && name.length > prefix.length) return prefix === "on" ? "handle" : normalizeCrud(prefix);
  }
  for (const suffix of crudSuffixes) {
    if (name.endsWith(suffix) && name.length > suffix.length) return normalizeCrud(suffix.toLowerCase().replace("handler", "handle"));
  }
  return undefined;
}

function normalizeCrud(value: string): string {
  if (value === "add" || value === "insert") return "create";
  if (value === "fetch" || value === "find" || value === "list") return "get";
  if (value === "set") return "update";
  if (value === "remove") return "delete";
  if (value === "on") return "handle";
  return value;
}

function namingPattern(name: string, bucket: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith(bucket)) return `${bucket}Noun prefix`;
  const aliases = aliasesFor(bucket);
  if (aliases.some((alias) => lower.startsWith(alias))) return `${bucket}Noun prefix`;
  if (bucket === "handle" && name.endsWith("Handler")) return "nounHandle suffix";
  if (aliases.some((alias) => name.endsWith(capitalize(alias)) || name.endsWith(`${capitalize(alias)}Handler`))) return `noun${capitalize(bucket)} suffix`;
  if (name.endsWith(capitalize(bucket))) return `noun${capitalize(bucket)} suffix`;
  return "mixed CRUD naming";
}

function aliasesFor(bucket: string): string[] {
  if (bucket === "create") return ["create", "add", "insert"];
  if (bucket === "get") return ["get", "fetch", "find", "list"];
  if (bucket === "update") return ["update", "set"];
  if (bucket === "delete") return ["delete", "remove"];
  if (bucket === "handle") return ["handle", "on"];
  return [bucket];
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
