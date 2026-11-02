/**
 * The most bytes read while looking for the header's newline. A header is far
 * shorter; this bounds the read on a headerless file with a long first line.
 */
const MAX_HEADER_BYTES = 4096;

const NEWLINE = 0x0a;

/** Matches the line {@link formatSnapshotHeader} writes. */
const HEADER_PATTERN =
  /^-- db-snapshots: driver=(\S+) connection=(.+) created=(\S+)$/;

/** The metadata a Snapshot Header records (ADR-0002). */
export interface SnapshotHeader {
  /**
   * The Driver as recorded. A header read from disk may name a Driver this
   * build does not support; it is kept so the creation time still counts.
   */
  driver: string;
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
 * Parses a Snapshot Header line.
 *
 * @param line - The first line of a Snapshot, without its newline.
 * @returns The recorded metadata, or undefined when the line is not a valid
 *   header (a foreign `.sql` file or a bad timestamp).
 */
export function parseSnapshotHeader(line: string): SnapshotHeader | undefined {
  const match = HEADER_PATTERN.exec(line.replace(/\r$/, ''));

  if (!match) {
    return undefined;
  }

  const [, driver = '', connection = '', createdText = ''] = match;
  const created = new Date(createdText);

  if (Number.isNaN(created.getTime())) {
    return undefined;
  }

  return { driver, connection, created };
}

/**
 * Reads the Snapshot Header of a Snapshot file. The file is streamed and the
 * read stops at the first newline, so the cost does not grow with the
 * Snapshot (ADR-0002).
 *
 * @param file - The path of the Snapshot file.
 * @returns The recorded metadata, or undefined for a headerless file.
 */
export async function readSnapshotHeader(
  file: string,
): Promise<SnapshotHeader | undefined> {
  const reader = Bun.file(file).stream().getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let ended = false;

  try {
    while (!ended && length <= MAX_HEADER_BYTES) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const newline = value.indexOf(NEWLINE);

      ended = newline !== -1;
      chunks.push(ended ? value.subarray(0, newline) : value);
      length += ended ? newline : value.length;
    }
  } finally {
    await reader.cancel();
  }

  if (length > MAX_HEADER_BYTES) {
    return undefined;
  }

  return parseSnapshotHeader(Buffer.concat(chunks).toString('utf8'));
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
