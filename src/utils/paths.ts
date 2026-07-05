import path from "node:path";

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function directoryBucket(relativePath: string, depth = 2): string {
  const parts = toPosixPath(relativePath).split("/");
  if (parts.length <= 1) return ".";
  return parts.slice(0, Math.min(depth, parts.length - 1)).join("/") || ".";
}

export function fileStem(relativePath: string): string {
  const base = path.basename(relativePath);
  return base.replace(/\.[^.]+$/, "");
}
