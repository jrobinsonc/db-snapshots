import { getDriver as defaultGetDriver } from '../drivers';
import type { Command, Snapshot } from '../types';
import { UserError } from '../utils/exceptions';
import { findConfigFile } from '../utils/find-config-file';
import { loadConfig } from '../utils/load-config';
import { progress as defaultProgress } from '../utils/output';
import { runner as defaultRunner } from '../utils/process-runner';
import type { ProcessRunner } from '../utils/process-runner';
import { ask as promptAsk } from '../utils/prompt';
import { createConnectionResolver } from '../utils/resolve-connection';
import { findSnapshot, listSnapshots } from '../utils/snapshot-repository';

interface LoadDeps {
  /** The directory used to locate the project config. */
  cwd: () => string;
  /** The prompt helper's `ask`. */
  ask: typeof promptAsk;
  /** Looks up the Driver a Connection declares. */
  getDriver: typeof defaultGetDriver;
  /** The process runner, for binary preflight. */
  runner: ProcessRunner;
  /** Reports progress on stderr. */
  progress: typeof defaultProgress;
}

/**
 * Prepends SQL statements in front of a Snapshot stream without buffering
 * the file in memory.
 *
 * @param statements - Non-empty SQL statements to run before the Snapshot.
 * @param snapshot - The Snapshot file stream.
 * @returns A stream yielding `statements` followed by `snapshot`.
 */
function prependStatements(
  statements: string,
  snapshot: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const prefix = new TextEncoder().encode(`${statements}\n`);
  const reader = snapshot.getReader();
  let prefixSent = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!prefixSent) {
        prefixSent = true;
        controller.enqueue(prefix);
        return;
      }

      const { done, value } = await reader.read();

      if (done) {
        reader.releaseLock();
        controller.close();
        return;
      }

      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * Resolves the Snapshot to load: the exact Snapshot Name when one is given,
 * otherwise the one picked from the Snapshot Storage.
 *
 * @param storage - The Snapshot Storage directory.
 * @param name - The Snapshot Name, as typed.
 * @param ask - Prompt helper for selecting from available Snapshots.
 * @returns The Snapshot.
 * @throws {UserError} with code `snapshot_not_found` when there is no match.
 */
async function resolveSnapshot(
  storage: string,
  name: string | undefined,
  ask: typeof promptAsk,
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

/**
 * Builds the `load` command.
 *
 * @param deps - Overridable collaborators, for tests.
 * @returns The command.
 */
export function createLoad(deps: LoadDeps): Command {
  const resolveConnection = createConnectionResolver({ ask: deps.ask });

  return async ({ args }) => {
    const config = loadConfig(findConfigFile(deps.cwd()));
    const nameArgument = args.get(0);
    const snapshot = await resolveSnapshot(
      config.storage,
      typeof nameArgument === 'string' ? nameArgument : undefined,
      deps.ask,
    );

    const { name: connectionName, connection } =
      await resolveConnection(config);
    const driver = deps.getDriver(connection.driver);

    deps.runner.preflight(driver.binaries.load);

    const startedAt = Date.now();

    deps.progress(`Loading Snapshot "${snapshot.name}"...`);

    try {
      const dropStatements = await driver.dropAllStatements(connection);
      const file = Bun.file(snapshot.file);

      // Bun.file() is streamed into the client's stdin, never read into memory.
      await driver.load(connection, {
        input:
          dropStatements === ''
            ? file
            : prependStatements(dropStatements, file.stream()),
      });
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
      dropped: true,
      duration_ms: Date.now() - startedAt,
    };
  };
}

export default createLoad({
  cwd: () => process.cwd(),
  ask: promptAsk,
  getDriver: defaultGetDriver,
  runner: defaultRunner,
  progress: defaultProgress,
});

export const options = {};
