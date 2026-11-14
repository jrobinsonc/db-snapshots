import { getDriver as defaultGetDriver } from '../drivers';
import type { Command } from '../types';
import { UserError } from '../utils/exceptions';
import { findConfigFile } from '../utils/find-config-file';
import { loadConfig } from '../utils/load-config';
import { progress as defaultProgress } from '../utils/output';
import { runner as defaultRunner } from '../utils/process-runner';
import type { ProcessRunner } from '../utils/process-runner';
import { ask as promptAsk } from '../utils/prompt';
import { createConnectionResolver } from '../utils/resolve-connection';
import { createSnapshotResolver } from '../utils/snapshot-repository';

interface LoadDeps {
  /** The prompt helper's `ask`. */
  ask: typeof promptAsk;
  /** The directory used to locate the project config. */
  cwd: () => string;
  /** Looks up the Driver for a Connection. */
  getDriver: typeof defaultGetDriver;
  /** Reports progress on stderr. */
  progress?: typeof defaultProgress;
  /** The process runner used for binary preflight. */
  runner: ProcessRunner;
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
 * Builds the `load` command.
 *
 * @param deps - Overridable collaborators, for tests.
 * @returns The command.
 */
export function createLoad(deps: LoadDeps): Command {
  const reportProgress = deps.progress ?? defaultProgress;
  const resolveConnection = createConnectionResolver({ ask: deps.ask });
  const resolveSnapshot = createSnapshotResolver({
    ask: deps.ask,
    progress: reportProgress,
  });

  return async ({ args }) => {
    const config = loadConfig(findConfigFile(deps.cwd()));
    const nameArgument = args.get(0);
    const snapshot = await resolveSnapshot(
      config.storage,
      typeof nameArgument === 'string' ? nameArgument : undefined,
    );

    const { name: connectionName, connection } =
      await resolveConnection(config);
    const driver = deps.getDriver(connection.driver);

    if (snapshot.driver !== null && snapshot.driver !== driver.name) {
      throw new UserError(
        `Snapshot "${snapshot.name}" was created with Driver "${snapshot.driver}" and cannot be loaded into Connection "${connectionName}" (Driver "${driver.name}").`,
        'driver_mismatch',
      );
    }

    deps.runner.preflight(driver.binaries.load);

    const startedAt = Date.now();

    reportProgress(`Loading Snapshot "${snapshot.name}"...`);

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
  ask: promptAsk,
  cwd: () => process.cwd(),
  getDriver: defaultGetDriver,
  runner: defaultRunner,
});

export const options = {};
