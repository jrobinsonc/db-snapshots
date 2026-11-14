import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDriver as defaultGetDriver } from '../drivers';
import { UserError, raise } from '../utils/exceptions';
import describeSnapshot from '../utils/describe-snapshot';
import { findConfigFile } from '../utils/find-config-file';
import { loadConfig } from '../utils/load-config';
import { localTimeParts } from '../utils/local-time';
import { progress } from '../utils/output';
import { confirm as promptConfirm, ask as promptAsk } from '../utils/prompt';
import { createConnectionResolver } from '../utils/resolve-connection';
import { runner as defaultRunner } from '../utils/process-runner';
import type { ProcessRunner } from '../utils/process-runner';
import { writeSnapshotFile } from '../utils/snapshot-header';
import type { SnapshotHeader } from '../utils/snapshot-header';
import type { Command } from '../types';

interface CreateDeps {
  /** The prompt helper's `ask`. */
  ask: typeof promptAsk;
  /** The prompt helper's `confirm`. */
  confirm: typeof promptConfirm;
  /** The directory used to locate the project config. */
  cwd: () => string;
  /** Looks up the Driver for a Connection. */
  getDriver: typeof defaultGetDriver;
  /** The process runner used for binary preflight. */
  runner: ProcessRunner;
  /** The clock, for the creation time and Automatic Snapshot names. */
  now: () => Date;
}

/**
 * Formats a dump file name
 *
 * @param name - The name of the dump file
 * @returns The formatted name
 * @throws If the name is not given
 */
function formatFilename(name: string): string {
  return (name || raise(new UserError('No dump file name provided', 'usage')))
    .trim()
    .replaceAll(/[^\da-z-]+/gi, '-')
    .replaceAll(/-+/g, '-');
}

/**
 * Names an Automatic Snapshot after its Connection and creation time.
 *
 * @param connection - The Connection name.
 * @param created - The creation time, formatted in local time.
 * @returns For example `local_2026-10-31_21-30-00`.
 */
function automaticSnapshotName(connection: string, created: Date): string {
  const { date, time } = localTimeParts(created);

  return `${connection}_${date}_${time.join('-')}`;
}

interface DumpFile {
  /** The name of the dump file */
  name: string;
  /** The path to the dump file */
  path: string;
  /** Whether or not the dump file exists */
  exists: boolean;
}

/**
 * Locates the Snapshot file for a Snapshot Name in the Snapshot Storage.
 *
 * @param name - The Snapshot Name.
 * @param storage - The Snapshot Storage directory.
 * @param confirm - The prompt helper's `confirm`.
 * @returns A promise that resolves with the dump file, or undefined if the user declines to overwrite it
 */
async function getDump(
  name: string,
  storage: string,
  confirm: typeof promptConfirm,
): Promise<DumpFile | undefined> {
  const path = join(storage, `${name}.sql`);
  const exists = existsSync(path);

  // If the file already exists, ask if the user wants to overwrite it.
  if (exists) {
    const confirmed = await confirm(
      "You're sure you want to overwrite this file?",
    );

    if (!confirmed) {
      return;
    }
  }

  return { name, path, exists };
}

/**
 * Builds the `create` command.
 *
 * @param deps - Overridable collaborators, for tests.
 * @returns The command.
 */
export function createCreate(deps: CreateDeps): Command {
  const resolveConnection = createConnectionResolver({ ask: deps.ask });

  return async ({ args }) => {
    // Resolved first so a config problem fails before any Snapshot prompt.
    const config = loadConfig(findConfigFile(deps.cwd()));
    const { name: connectionName, connection } =
      await resolveConnection(config);
    const driver = deps.getDriver(connection.driver);

    deps.runner.preflight(driver.binaries.dump);

    const created = deps.now();
    const nameArgument = args.get(0);
    const dump = await getDump(
      nameArgument === undefined
        ? automaticSnapshotName(connectionName, created)
        : formatFilename(String(nameArgument)),
      config.storage,
      deps.confirm,
    );

    if (!dump) {
      return;
    }

    const header: SnapshotHeader = {
      driver: driver.name,
      connection: connectionName,
      created,
    };

    mkdirSync(config.storage, { recursive: true });

    progress('Creating dump file...');

    await driver.dump(connection, {
      stdout: (output) => writeSnapshotFile(dump.path, header, output),
    });

    return {
      kind: 'create',
      snapshot: describeSnapshot(dump.name, dump.path, header),
      overwritten: dump.exists,
    };
  };
}

export default createCreate({
  ask: promptAsk,
  confirm: promptConfirm,
  cwd: () => process.cwd(),
  getDriver: defaultGetDriver,
  runner: defaultRunner,
  now: () => new Date(),
});

export const options = {};
