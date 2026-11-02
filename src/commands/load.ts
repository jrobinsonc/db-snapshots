import { UserError } from '../utils/exceptions';
import { findConfigFile } from '../utils/find-config-file';
import { loadConfig } from '../utils/load-config';
import { progress } from '../utils/output';
import { ask } from '../utils/prompt';
import { resolveConnection } from '../utils/resolve-connection';
import { findSnapshot, listSnapshots } from '../utils/snapshot-repository';
import { getDriver } from '../drivers';
import { runner } from '../utils/process-runner';
import type { Command, Snapshot } from '../types';

/**
 * Resolves the Snapshot to load: the exact Snapshot Name when one is given,
 * otherwise the one picked from the Snapshot Storage.
 *
 * @param storage - The Snapshot Storage directory.
 * @param name - The Snapshot Name, as typed.
 * @returns The Snapshot.
 * @throws {UserError} with code `snapshot_not_found` when there is no match.
 */
async function resolveSnapshot(
  storage: string,
  name: string | undefined,
): Promise<Snapshot> {
  if (name !== undefined) {
    const snapshot = await findSnapshot(storage, name);

    if (!snapshot) {
      throw new UserError(
        `Snapshot "${name}" was not found in ${storage}.`,
        'snapshot_not_found',
      );
    }

    return snapshot;
  }

  // Newest first, so the picker opens on the latest Snapshot.
  const snapshots = await listSnapshots(storage);

  if (snapshots.length === 0) {
    throw new UserError(
      `No Snapshots found in ${storage}.`,
      'snapshot_not_found',
    );
  }

  const { picked } = await ask<{ picked: Snapshot }>([
    {
      type: 'search',
      name: 'picked',
      message: 'Select the Snapshot:',
      source: (_, input = '') =>
        snapshots
          .filter((snapshot) => snapshot.name.includes(input))
          .map((snapshot) => ({ name: snapshot.name, value: snapshot })),
    },
  ]);

  return picked;
}

const load: Command = async ({ args }) => {
  const config = loadConfig(findConfigFile());
  const nameArgument = args.get(0);
  const snapshot = await resolveSnapshot(
    config.storage,
    typeof nameArgument === 'string' ? nameArgument : undefined,
  );

  const { name: connectionName, connection } = await resolveConnection(config);
  const driver = getDriver(connection.driver);

  runner.preflight(driver.binaries.load);

  const startedAt = Date.now();

  progress(`Loading Snapshot "${snapshot.name}"...`);

  try {
    // Bun.file() is streamed into the client's stdin, never read into memory.
    await driver.load(connection, { input: Bun.file(snapshot.file) });
  } catch (error) {
    if (error instanceof UserError && error.code === 'client_failed') {
      throw new UserError(
        `Loading Snapshot "${snapshot.name}" into Connection "${connectionName}" failed; the database may be partially loaded.\n${error.message}`,
        'client_failed',
      );
    }

    throw error;
  }

  return {
    kind: 'load',
    snapshot,
    connection: connectionName,
    dropped: false,
    duration_ms: Date.now() - startedAt,
  };
};

export default load;

export const options = {};
