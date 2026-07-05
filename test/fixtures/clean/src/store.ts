import fs from "node:fs/promises";
import path from "node:path";
import { deserialize } from "./codec.js";

export interface Entry {
  key: string;
  value: string;
}

export async function readEntries(directory: string): Promise<Entry[]> {
  const names = await fs.readdir(directory);
  const entries: Entry[] = [];
  for (const name of names) {
    // Skip editor swap files; they appear mid-save and are never valid JSON.
    if (name.endsWith(".swp") || name.startsWith(".")) continue;
    const raw = await fs.readFile(path.join(directory, name), "utf8");
    entries.push(deserialize(raw));
  }
  return entries;
}

export async function writeEntry(directory: string, entry: Entry): Promise<void> {
  const target = path.join(directory, `${entry.key}.json`);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(entry), "utf8");
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.unlink(temporary);
    throw error;
  }
}
