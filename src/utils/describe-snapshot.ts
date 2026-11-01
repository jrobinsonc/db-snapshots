import { statSync } from 'node:fs';
import type { Snapshot } from '../types';

/**
 * Builds the Snapshot object for a dump file on disk.
 *
 * @param name - The snapshot name.
 * @param file - The path to the dump file.
 * @returns The Snapshot object.
 */
export default function describeSnapshot(name: string, file: string): Snapshot {
  const stats = statSync(file);

  return {
    name,
    file,
    connection: null,
    driver: null,
    created_at: stats.mtime.toISOString(),
    size_bytes: stats.size,
    compressed: file.endsWith('.gz'),
  };
}
