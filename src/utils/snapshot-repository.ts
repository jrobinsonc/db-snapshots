import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Snapshot } from '../types';
import describeSnapshot from './describe-snapshot';
import { readSnapshotHeader } from './snapshot-header';

const SNAPSHOT_EXTENSION = '.sql';

/**
 * Lists the file names at the top level of the Snapshot Storage. A missing
 * Snapshot Storage holds no Snapshots.
 *
 * @param storage - The Snapshot Storage directory.
 * @returns The entry names.
 */
function readStorage(storage: string): string[] {
  try {
    return readdirSync(storage);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

/**
 * Finds every Snapshot in the Snapshot Storage. Only top-level `.sql` files
 * count; subdirectories are ignored.
 *
 * @param storage - The Snapshot Storage directory.
 * @returns The Snapshots, newest first by creation time (Snapshot Header,
 *   else file mtime).
 */
export async function listSnapshots(storage: string): Promise<Snapshot[]> {
  const files = readStorage(storage)
    .filter((entry) => entry.endsWith(SNAPSHOT_EXTENSION))
    .map((entry) => ({
      name: entry.slice(0, -SNAPSHOT_EXTENSION.length),
      path: join(storage, entry),
    }))
    .filter(({ path }) => statSync(path).isFile());

  const snapshots = await Promise.all(
    files.map(async ({ name, path }) =>
      describeSnapshot(name, path, await readSnapshotHeader(path)),
    ),
  );

  return snapshots.sort(
    (a, b) =>
      Date.parse(b.created_at) - Date.parse(a.created_at) ||
      a.name.localeCompare(b.name),
  );
}
