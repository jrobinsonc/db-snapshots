import { statSync } from 'node:fs';
import type { Snapshot } from '../types';
import { toIsoSeconds } from './snapshot-header';
import type { SnapshotHeader } from './snapshot-header';

/**
 * Builds the Snapshot object for a dump file on disk.
 *
 * @param name - The snapshot name.
 * @param file - The path to the dump file.
 * @param header - The file's Snapshot Header; without one, the creation time
 *   falls back to the file's mtime and the Connection/Driver are unknown.
 * @returns The Snapshot object.
 */
export default function describeSnapshot(
  name: string,
  file: string,
  header?: SnapshotHeader,
): Snapshot {
  const stats = statSync(file);

  return {
    name,
    file,
    connection: header?.connection ?? null,
    driver: header?.driver ?? null,
    created_at: toIsoSeconds(header?.created ?? stats.mtime),
    size_bytes: stats.size,
    compressed: file.endsWith('.gz'),
  };
}
