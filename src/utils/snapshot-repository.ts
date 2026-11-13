import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Snapshot } from '../types';
import describeSnapshot from './describe-snapshot';
import { readSnapshotHeader } from './snapshot-header';

const SNAPSHOT_EXTENSION = '.sql';

/**
 * @param name - A Snapshot Name.
 * @returns The file name of that Snapshot in the Snapshot Storage.
 */
function snapshotFileName(name: string): string {
  return `${name}${SNAPSHOT_EXTENSION}`;
}

/**
 * @param entry - A Snapshot Storage entry name.
 * @returns Its Snapshot Name, or undefined when it is not a Snapshot file name.
 */
function snapshotNameOf(entry: string): string | undefined {
  return entry.endsWith(SNAPSHOT_EXTENSION)
    ? entry.slice(0, -SNAPSHOT_EXTENSION.length)
    : undefined;
}

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
 * Describes one Snapshot Storage entry, if it is a Snapshot.
 *
 * @param storage - The Snapshot Storage directory.
 * @param entry - A top-level entry name.
 * @returns The Snapshot, or undefined when the entry is not a Snapshot file.
 */
async function readSnapshot(
  storage: string,
  entry: string,
): Promise<Snapshot | undefined> {
  const name = snapshotNameOf(entry);

  if (name === undefined) {
    return;
  }

  const path = join(storage, entry);
  const stats = statSync(path);

  if (!stats.isFile()) {
    return;
  }

  return describeSnapshot(name, path, await readSnapshotHeader(path), stats);
}

/**
 * Finds the Snapshot with exactly this Snapshot Name. Only top-level files
 * count, so a name can never reach outside the Snapshot Storage.
 *
 * @param storage - The Snapshot Storage directory.
 * @param name - The Snapshot Name, as typed.
 * @returns The Snapshot, or undefined when there is none with that name.
 */
export async function findSnapshot(
  storage: string,
  name: string,
): Promise<Snapshot | undefined> {
  const entry = snapshotFileName(name);

  return readStorage(storage).includes(entry)
    ? readSnapshot(storage, entry)
    : undefined;
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
  const snapshots = (
    await Promise.all(
      readStorage(storage).map((entry) => readSnapshot(storage, entry)),
    )
  ).filter((snapshot) => snapshot !== undefined);

  return snapshots.sort(
    (a, b) =>
      Date.parse(b.created_at) - Date.parse(a.created_at) ||
      a.name.localeCompare(b.name),
  );
}
