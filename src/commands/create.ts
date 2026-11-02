import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDriver } from '../drivers';
import { UserError, raise } from '../utils/exceptions';
import describeSnapshot from '../utils/describe-snapshot';
import { localTimeParts } from '../utils/local-time';
import { progress } from '../utils/output';
import { confirm } from '../utils/prompt';
import { resolveProjectConnection } from '../utils/resolve-connection';
import { runner } from '../utils/process-runner';
import { writeSnapshotFile } from '../utils/snapshot-header';
import type { SnapshotHeader } from '../utils/snapshot-header';
import type { Command } from '../types';

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
 * @returns A promise that resolves with the dump file, or undefined if the user declines to overwrite it
 */
async function getDump(
  name: string,
  storage: string,
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

const create: Command = async ({ args }) => {
  // Resolved first so a config problem fails before any Snapshot prompt.
  const {
    name: connectionName,
    connection,
    config,
  } = await resolveProjectConnection();
  const driver = getDriver(connection.driver);

  runner.preflight(driver.binaries.dump);

  const created = new Date();
  const nameArgument = args.get(0);
  const dump = await getDump(
    nameArgument === undefined
      ? automaticSnapshotName(connectionName, created)
      : formatFilename(String(nameArgument)),
    config.storage,
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

export default create;

export const options = {};
