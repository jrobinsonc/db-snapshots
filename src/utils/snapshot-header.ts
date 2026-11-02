import type { DriverName } from '../drivers';

/** The metadata a Snapshot Header records (ADR-0002). */
export interface SnapshotHeader {
  driver: DriverName;
  connection: string;
  created: Date;
}

/**
 * Formats a time as ISO-8601 UTC with second precision.
 *
 * @param date - The time.
 * @returns For example `2026-10-31T21:30:00Z`.
 */
export function toIsoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

/**
 * Formats the Snapshot Header line, without its trailing newline.
 *
 * @param header - The metadata to record.
 * @returns For example `-- db-snapshots: driver=mysql connection=local created=2026-10-31T21:30:00Z`.
 */
export function formatSnapshotHeader(header: SnapshotHeader): string {
  return `-- db-snapshots: driver=${header.driver} connection=${header.connection} created=${toIsoSeconds(header.created)}`;
}

/**
 * Writes a Snapshot file: the header line, then the dump streamed as it
 * arrives.
 *
 * @param file - The path to write.
 * @param header - The metadata to record.
 * @param output - The dump client's output.
 */
export async function writeSnapshotFile(
  file: string,
  header: SnapshotHeader,
  output: ReadableStream<Uint8Array>,
): Promise<void> {
  const sink = Bun.file(file).writer();

  try {
    sink.write(`${formatSnapshotHeader(header)}\n`);

    for await (const chunk of output) {
      await sink.write(chunk);
    }
  } finally {
    await sink.end();
  }
}
