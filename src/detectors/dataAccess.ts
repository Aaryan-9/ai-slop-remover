import type { Detector, Finding, ParsedFile } from "../types.js";
import { dedupeBy, groupBy } from "../utils/collections.js";
import { isApplicationCode } from "../utils/fileKinds.js";
import { directoryBucket, fileStem } from "../utils/paths.js";
import { severityFromFrequency } from "../utils/severity.js";
import { clampSnippet, lineForIndex, percent } from "../utils/text.js";
import { driftConfidence } from "./common.js";

const dataLayerName = /(repository|repositories|repo|dao|service|store|model|database|db|persistence|queries)/i;

const jsDbLibraries = new Set([
  "pg", "mysql", "mysql2", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "sequelize",
  "knex", "typeorm", "drizzle-orm", "kysely", "prisma", "@prisma/client", "@supabase/supabase-js",
  "firebase-admin", "redis", "ioredis", "@planetscale/database", "@neondatabase/serverless", "postgres"
]);
const pythonDbLibraries = new Set([
  "psycopg2", "psycopg", "sqlalchemy", "pymongo", "redis", "sqlite3", "peewee", "tortoise",
  "databases", "asyncpg", "aiomysql", "pymysql", "motor"
]);
const goDbImportPath = /^database\/sql$|gorm\.io\/gorm|jmoiron\/sqlx|jackc\/pgx|go-redis\/redis|redis\/go-redis|mongo-driver|entgo\.io\/ent|Masterminds\/squirrel|uptrace\/bun/;
const dbClientModuleStem = /^(db|database|prisma|client|pool|knex|drizzle|supabase|redis|mongo)$/i;

interface DbUse {
  file: ParsedFile;
  identifier: string;
  line: number;
  group: string;
  evidence: string;
  isDataLayer: boolean;
}

export const dataAccessDetector: Detector = {
  id: "data_access",
  displayName: "Data access pattern drift",
  run({ files }) {
    const uses = files
      .filter((file) => isApplicationCode(file.relativePath))
      .flatMap(extractDbUses);
    if (uses.length < 4) return [];

    const inferredDataDirs = inferDataLayerDirectories(uses);
    const findings: Finding[] = [];
    const byGroup = groupBy(uses, (use) => use.group);

    for (const [group, groupUses] of byGroup) {
      if (groupUses.length < 4) continue;
      const dataLayerCount = groupUses.filter((use) => use.isDataLayer || inferredDataDirs.has(parentDirectory(use.file.relativePath))).length;
      const frequency = dataLayerCount / groupUses.length;
      if (frequency < 0.8) continue;

      for (const use of groupUses) {
        const directory = parentDirectory(use.file.relativePath);
        if (use.isDataLayer || inferredDataDirs.has(directory)) continue;
        findings.push({
          category: "data_access",
          title: "Direct data access outside the data layer",
          file: use.file.relativePath,
          line_start: use.line,
          line_end: use.line,
          pattern_observed: `direct ${use.identifier} access outside data layer`,
          dominant_pattern: "DB access through repository/service/store layer",
          dominant_frequency: frequency,
          severity: severityFromFrequency(frequency, groupUses.length),
          confidence: driftConfidence(frequency, groupUses.length),
          fix_hint: `Move this ${use.identifier} call into the repository/service layer the rest of ${group} uses, and call that layer from here instead.`,
          group,
          evidence: use.evidence,
          explanation: `${percent(frequency)} of comparable DB usage in ${group} is concentrated in repository/service/store-style files, but this file reaches ${use.identifier} directly.`
        });
      }
    }

    return findings;
  }
};

function extractDbUses(file: ParsedFile): DbUse[] {
  const clientIdentifiers = dbClientIdentifiers(file);
  if (clientIdentifiers.size === 0) return [];

  const uses: DbUse[] = [];
  const escaped = [...clientIdentifiers].map((identifier) => identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const accessRegex = new RegExp(`\\b(${escaped.join("|")})\\s*\\.`, "g");
  for (const match of file.source.matchAll(accessRegex)) {
    const identifier = match[1];
    if (!identifier || match.index === undefined) continue;
    uses.push({
      file,
      identifier,
      line: lineForIndex(file.source, match.index),
      group: directoryBucket(file.relativePath),
      evidence: clampSnippet(currentLine(file.source, match.index), 120),
      isDataLayer: isDataLayerFile(file)
    });
  }
  return dedupeBy(uses, (use) => `${use.file.relativePath}:${use.line}:${use.identifier}`);
}

/** Identifiers in this file that are provably database clients, traced from imports. */
function dbClientIdentifiers(file: ParsedFile): Set<string> {
  const identifiers = new Set<string>();

  if (file.language === "python") {
    for (const match of file.source.matchAll(/^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm)) {
      const top = match[1]?.split(".")[0];
      if (top && pythonDbLibraries.has(top)) identifiers.add(match[2] ?? top);
    }
    for (const match of file.source.matchAll(/^\s*from\s+([\w.]+)\s+import\s+(.+)$/gm)) {
      const top = match[1]?.split(".")[0];
      if (top && pythonDbLibraries.has(top)) {
        for (const imported of (match[2] ?? "").split(",")) {
          const name = imported.trim().match(/^(\w+)(?:\s+as\s+(\w+))?/);
          if (name) identifiers.add(name[2] ?? name[1]!);
        }
      }
    }
    return identifiers;
  }

  if (file.language === "go") {
    const record = (alias: string | undefined, importPath: string) => {
      if (!goDbImportPath.test(importPath)) return;
      const segments = importPath.split("/");
      const last = segments[segments.length - 1]!;
      identifiers.add(alias ?? (/^v\d+$/.test(last) ? segments[segments.length - 2]! : last));
    };
    for (const match of file.source.matchAll(/^import\s+(?:([\w.]+)\s+)?"([^"]+)"/gm)) {
      record(match[1], match[2]!);
    }
    for (const block of file.source.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) {
      for (const entry of block[1]!.matchAll(/(?:^|\n)\s*(?:([\w.]+)\s+)?"([^"]+)"/g)) {
        record(entry[1], entry[2]!);
      }
    }
    return identifiers;
  }

  if (file.language !== "javascript" && file.language !== "typescript") return identifiers;

  for (const match of file.source.matchAll(/import\s+(?:(\w+)|\{([^}]+)\}|(\w+)\s*,\s*\{([^}]+)\})\s+from\s+["']([^"']+)["']/g)) {
    const source = match[5] ?? "";
    if (!isDbImportSource(source)) continue;
    for (const name of importedNames(match)) identifiers.add(name);
  }
  for (const match of file.source.matchAll(/(?:const|let|var)\s+(?:(\w+)|\{([^}]+)\})\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const source = match[3] ?? "";
    if (!isDbImportSource(source)) continue;
    if (match[1]) identifiers.add(match[1]);
    for (const name of destructuredNames(match[2])) identifiers.add(name);
  }
  // Locally constructed clients: const db = new PrismaClient() / drizzle(...) / createClient(...).
  for (const match of file.source.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:new\s+(?:PrismaClient|Pool|Client|MongoClient|Sequelize)\b|drizzle\s*\(|createClient\s*\(|knex\s*\()/g)) {
    if (match[1]) identifiers.add(match[1]);
  }
  return identifiers;
}

function isDbImportSource(source: string): boolean {
  if (jsDbLibraries.has(source)) return true;
  if (source.startsWith(".")) {
    const stem = fileStem(source);
    return dbClientModuleStem.test(stem);
  }
  return false;
}

function importedNames(match: RegExpMatchArray): string[] {
  const names: string[] = [];
  if (match[1]) names.push(match[1]);
  if (match[3]) names.push(match[3]);
  names.push(...destructuredNames(match[2]), ...destructuredNames(match[4]));
  return names;
}

function destructuredNames(clause: string | undefined): string[] {
  if (!clause) return [];
  return clause
    .split(",")
    .map((part) => part.trim().match(/^(?:\w+\s+as\s+)?(\w+)$/)?.[1] ?? part.trim().split(/\s+as\s+/).pop() ?? "")
    .map((name) => name.trim())
    .filter((name) => /^\w+$/.test(name));
}

function currentLine(source: string, index: number): string {
  const start = source.lastIndexOf("\n", index) + 1;
  const end = source.indexOf("\n", index);
  return source.slice(start, end < 0 ? source.length : end);
}

function isDataLayerFile(file: ParsedFile): boolean {
  return dataLayerName.test(fileStem(file.relativePath)) || dataLayerName.test(parentDirectory(file.relativePath));
}

function inferDataLayerDirectories(uses: DbUse[]): Set<string> {
  const directoryUses = groupBy(uses, (use) => parentDirectory(use.file.relativePath));
  const inferred = new Set<string>();
  for (const [directory, items] of directoryUses) {
    if (items.length < 3) continue;
    const namedLayerCount = items.filter((use) => use.isDataLayer).length;
    if (namedLayerCount / items.length >= 0.65) inferred.add(directory);
  }
  return inferred;
}

function parentDirectory(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.length <= 1) return ".";
  return parts.slice(0, -1).join("/");
}
