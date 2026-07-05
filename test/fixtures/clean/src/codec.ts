import type { Entry } from "./store.js";

export function deserialize(raw: string): Entry {
  const parsed = JSON.parse(raw) as Partial<Entry>;
  if (typeof parsed.key !== "string" || typeof parsed.value !== "string") {
    throw new TypeError("entry must contain string key and value");
  }
  return { key: parsed.key, value: parsed.value };
}
