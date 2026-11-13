import { unlinkSync } from 'node:fs';

import type { Command, Snapshot } from '../types';
import { findConfigFile } from '../utils/find-config-file';
import { loadConfig } from '../utils/load-config';
import { listSnapshots } from '../utils/snapshot-repository';

const DEFAULT_KEEP = 2;
const AUTOMATIC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

interface CleanupDeps {
  /** The directory used to locate the project config. */
  cwd: () => string;
}

/**
 * Checks whether a Snapshot is an Automatic Snapshot whose filename agrees
 * with the Connection recorded in its Snapshot Header.
 *
 * @param snapshot - The Snapshot to inspect.
 * @returns True when the Snapshot is a Cleanup candidate.
 */
function isAutomaticSnapshot(snapshot: Snapshot): boolean {
  if (snapshot.connection === null) {
    return false;
  }

  const prefix = `${snapshot.connection}_`;

  return (
    snapshot.name.startsWith(prefix) &&
    AUTOMATIC_TIMESTAMP_PATTERN.test(snapshot.name.slice(prefix.length))
  );
}

/**
 * Builds the `cleanup` command.
 *
 * @param deps - Overridable collaborators, for tests.
 * @returns The command.
 */
export function createCleanup(deps: CleanupDeps): Command {
  return async () => {
    const { storage } = loadConfig(findConfigFile(deps.cwd()));
    const snapshots = await listSnapshots(storage);
    const retainedByConnection = new Map<string, Snapshot[]>();
    const kept: Snapshot[] = [];
    const deleted: Snapshot[] = [];

    for (const snapshot of snapshots) {
      if (snapshot.connection === null || !isAutomaticSnapshot(snapshot)) {
        continue;
      }

      const retained = retainedByConnection.get(snapshot.connection) ?? [];

      if (retained.length < DEFAULT_KEEP) {
        retained.push(snapshot);
        retainedByConnection.set(snapshot.connection, retained);
        kept.push(snapshot);
        continue;
      }

      unlinkSync(snapshot.file);
      deleted.push(snapshot);
    }

    return {
      kind: 'cleanup',
      deleted,
      kept,
      dry_run: false,
    };
  };
}

export default createCleanup({ cwd: () => process.cwd() });

export const options = {};
