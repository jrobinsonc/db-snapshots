import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
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

const EXIT_INTERRUPTED = 130;
const PARTIAL_SUFFIX = '.partial';

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
  /** Terminates the process when interrupted by SIGINT. */
  exit?: (code: number) => void;
}

/**
 * Validates and sanitizes a Named Snapshot's name, preserving `[A-Za-z0-9._-]`
 * and replacing any other character with `-`.
 *
 * @param name - The Snapshot Name given by the user.
 * @returns The sanitized Snapshot Name.
 * @throws {UserError} When the name is empty or starts with a dot.
 */
function sanitizeSnapshotName(name: string): string {
  if (name.length === 0) {
    raise(new UserError('Snapshot Name cannot be empty.', 'usage'));
  }

  if (name.startsWith('.')) {
    raise(
      new UserError(
        `Snapshot Name "${name}" cannot start with a dot.`,
        'usage',
      ),
    );
  }

  return name.replaceAll(/[^A-Za-z0-9._-]/g, '-');
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
    let confirmed: boolean;

    try {
      confirmed = await confirm("You're sure you want to overwrite this file?");
    } catch (error) {
      if (error instanceof UserError && error.code === 'input_required') {
        throw new UserError(
          `Snapshot "${name}" already exists in ${storage}.`,
          'snapshot_exists',
        );
      }

      throw error;
    }

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
  const exit = deps.exit ?? ((code: number) => process.exit(code));

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
        : sanitizeSnapshotName(String(nameArgument)),
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

    const partialPath = `${dump.path}${PARTIAL_SUFFIX}`;
    const removePartial = () => {
      rmSync(partialPath, { force: true });
    };
    let interrupted = false;
    const onSigint = () => {
      interrupted = true;
      removePartial();
      exit(EXIT_INTERRUPTED);
    };

    // Prepend so the partial file is removed before any process-wide SIGINT exit.
    process.prependOnceListener('SIGINT', onSigint);
    process.once('exit', removePartial);

    try {
      await driver.dump(connection, {
        stdout: (output) => writeSnapshotFile(partialPath, header, output),
      });

      if (interrupted) {
        removePartial();
        return;
      }

      process.off('exit', removePartial);
      renameSync(partialPath, dump.path);
    } catch (error) {
      removePartial();

      throw error;
    } finally {
      process.off('SIGINT', onSigint);
      process.off('exit', removePartial);
    }

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
