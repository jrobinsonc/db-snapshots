import fs from "node:fs";
import path from "node:path";

import { UserError } from "./exceptions";

/** The name of the project config file. */
export const CONFIG_FILE_NAME = ".db-snapshots.json";

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Walks up from `startDir` looking for the nearest `.db-snapshots.json`.
 *
 * @param startDir - Directory to start from; defaults to the current directory
 * @returns the absolute path of the nearest config file
 * @throws {UserError} with code `config_not_found` when none exists
 */
export function findConfigFile(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, CONFIG_FILE_NAME);

    if (isFile(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      throw new UserError(
        "Config file not found. Run `dbs init` to create one.",
        "config_not_found",
      );
    }

    current = parent;
  }
}
