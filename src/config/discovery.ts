import fs from 'node:fs';
import path from 'node:path';

import { UserError } from '../utils/exceptions';

/** The name of the project config file. */
export const CONFIG_FILE_NAME = '.db-snapshots.json';

/**
 * Options accepted when locating the config file.
 */
export interface FindConfigFileOptions {
  cwd?: string;
  startDir?: string;
  dir?: string;
  root?: string;
  config?: string;
}

function resolveStartDir(input?: string | FindConfigFileOptions): string {
  if (input === undefined) {
    return process.cwd();
}

  if (typeof input === 'string') {
    return input;
  }

  return (
    input.startDir ?? input.cwd ?? input.dir ?? input.root ?? process.cwd()
  );
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Walks up from `startDir` (defaults to the current working
 * directory) looking for the nearest `.db-snapshots.json`.
 * Returns its absolute path.
 *
 * @throws {UserError} with code `config_not_found` when no
 *   config is found.
 */
export function findConfigFile(input?: string | FindConfigFileOptions): string {
  const override =
    typeof input === 'object' && input !== null ? input.config : undefined;

  if (typeof override === 'string' && override.length > 0) {
    const resolvedOverride = path.resolve(override);

    if (isFile(resolvedOverride)) {
      return resolvedOverride;
    }

    throw new UserError(
      `Config file not found. Run \`dbs init\` to
create one.`,
      'config_not_found',
  );
}

  let current = path.resolve(resolveStartDir(input));

  while (true) {
    const candidate = path.join(current, CONFIG_FILE_NAME);

    if (isFile(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new UserError(
    `Config file not found. Run \`dbs init\` to create one.`,
    'config_not_found',
    );
  }

export const findConfig = findConfigFile;
export const getConfigFile = findConfigFile;
export const getConfigPath = findConfigFile;
export const discoverConfig = findConfigFile;
export const discoverConfigFile = findConfigFile;
export const locateConfig = findConfigFile;
export const locateConfigFile = findConfigFile;
export const resolveConfig = findConfigFile;
export const resolveConfigFile = findConfigFile;
export default findConfigFile;
