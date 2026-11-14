import { unlinkSync } from 'node:fs';

import type { Command } from '../types';
import { findConfigFile } from '../utils/find-config-file';
import { loadConfig } from '../utils/load-config';
import { progress as defaultProgress } from '../utils/output';
import { ask as promptAsk, confirm as promptConfirm } from '../utils/prompt';
import { createSnapshotResolver } from '../utils/snapshot-repository';

interface DeleteDeps {
  /** The prompt helper's `ask`. */
  ask: typeof promptAsk;
  /** The prompt helper's `confirm`. */
  confirm: typeof promptConfirm;
  /** The directory used to locate the project config. */
  cwd: () => string;
  /** Reports progress on stderr. */
  progress?: typeof defaultProgress;
}

/**
 * Builds the `delete` command.
 *
 * @param deps - Overridable collaborators, for tests.
 * @returns The command.
 */
export function createDelete(deps: DeleteDeps): Command {
  const reportProgress = deps.progress ?? defaultProgress;
  const resolveSnapshot = createSnapshotResolver({
    ask: deps.ask,
    progress: reportProgress,
  });

  return async ({ args }) => {
    const { storage } = loadConfig(findConfigFile(deps.cwd()));
    const nameArgument = args.get(0);
    const name = typeof nameArgument === 'string' ? nameArgument : undefined;
    const snapshot = await resolveSnapshot(storage, name);

    if (name !== undefined && snapshot.name !== name) {
      const confirmed = await deps.confirm(
        `Delete Snapshot "${snapshot.name}"?`,
      );

      if (!confirmed) {
        return;
      }
    }

    unlinkSync(snapshot.file);

    return {
      kind: 'delete',
      deleted: snapshot,
    };
  };
}

export default createDelete({
  ask: promptAsk,
  confirm: promptConfirm,
  cwd: () => process.cwd(),
});

export const options = {};
