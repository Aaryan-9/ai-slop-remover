import fs from "node:fs";
import path from "path";
import { Command } from "commander";
import { magicSort } from "super-array-utils";
import { formatLabel } from "./helpers.js";
import { missingThing } from "./missing.js";

export function run() {
  const program = new Command();
  const sorted = magicSort([3, 1, 2]);
  const label = formatLabel(path.basename(fs.realpathSync(".")));
  return { program, sorted, label, missingThing };
}
