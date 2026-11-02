import type { CommandResult, Snapshot } from '../types';

type Color = 'red' | 'green' | 'yellow';

/** Shown for a value a headerless Snapshot does not record. */
const UNKNOWN = '—';

const BYTES_PER_UNIT = 1024;
const SIZE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;
const TIMESTAMP_PART_WIDTH = 2;

/** A stream that may be attached to a terminal. */
interface TtyLike {
  isTTY?: boolean;
}

let colorDisabled = false;

/** Turns color off for the rest of the process (the `--no-color` flag). */
export function disableColor(): void {
  colorDisabled = true;
}

/** Undoes {@link disableColor}. */
export function enableColor(): void {
  colorDisabled = false;
}

/**
 * Decides whether ANSI color should be used for a stream.
 *
 * @param stream - The stream the text will be written to.
 * @param env - The process environment.
 * @returns True when the stream is a TTY and neither `--no-color` nor
 *   `NO_COLOR` is set.
 */
export function isColorEnabled(
  stream: TtyLike,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (colorDisabled || env['NO_COLOR']) {
    return false;
  }

  return stream.isTTY === true || Boolean(env['FORCE_COLOR']);
}

/**
 * Wraps text in an ANSI color using Bun's native color support.
 *
 * @param text - The text to color.
 * @param color - The color name.
 * @param enabled - When false the text is returned unchanged.
 * @returns The possibly colored text.
 */
export function colorize(text: string, color: Color, enabled: boolean): string {
  if (!enabled) {
    return text;
  }

  return `${Bun.color(color, 'ansi')}${text}\u001B[0m`;
}

/**
 * Formats a byte count for a human, in base 1024.
 *
 * @param bytes - The size in bytes.
 * @returns For example `512 B` or `1.5 MiB`.
 */
export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;

  // Compare the rounded value, so 1048575 B is `1.0 MiB`, not `1024.0 KiB`.
  while (
    Number(value.toFixed(1)) >= BYTES_PER_UNIT &&
    unit < SIZE_UNITS.length - 1
  ) {
    value /= BYTES_PER_UNIT;
    unit += 1;
  }

  const text = unit === 0 ? String(value) : value.toFixed(1);

  return `${text} ${SIZE_UNITS[unit]}`;
}

/**
 * Formats an ISO-8601 time in local time, matching Automatic Snapshot names.
 *
 * @param iso - The time, ISO-8601.
 * @returns For example `2026-10-31 21:30:00`.
 */
function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string =>
    String(value).padStart(TIMESTAMP_PART_WIDTH, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Renders Snapshots as an aligned table.
 *
 * @param snapshots - The Snapshots, in display order.
 * @returns The table, or "No snapshots found" when there are none.
 */
function renderSnapshotTable(snapshots: Snapshot[]): string {
  if (snapshots.length === 0) {
    return 'No snapshots found';
  }

  const header = [
    'Name',
    'Connection',
    'Driver',
    'Created at',
    'Size',
    'Compressed',
  ];
  const rows = [
    header,
    ...snapshots.map((snapshot) => [
      snapshot.name,
      snapshot.connection ?? UNKNOWN,
      snapshot.driver ?? UNKNOWN,
      formatLocalTime(snapshot.created_at),
      formatSize(snapshot.size_bytes),
      snapshot.compressed ? 'yes' : 'no',
    ]),
  ];
  const widths = header.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );

  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

/**
 * Renders a command result for a human.
 *
 * @param result - The result a command returned.
 * @param color - Whether to use ANSI color.
 * @returns The text to print.
 */
export function renderResult(result: CommandResult, color: boolean): string {
  switch (result.kind) {
    case 'create': {
      const verb = result.overwritten ? 'updated' : 'created';

      return colorize(
        `Dump file ${verb}: ${result.snapshot.name}`,
        'green',
        color,
      );
    }
    case 'load': {
      return colorize(
        `Dump file imported: ${result.snapshot.name}`,
        'green',
        color,
      );
    }
    case 'init': {
      const written = colorize(
        `Config written: ${result.config_file}`,
        'green',
        color,
      );

      if (result.password_env_var === null) {
        return written;
      }

      const advice = colorize(
        `The password was not written to the config. Add ${result.password_env_var}=<your password> to .env and keep .env out of version control.`,
        'yellow',
        color,
      );

      return `${written}\n${advice}`;
    }
    case 'list': {
      return renderSnapshotTable(result.snapshots);
    }
  }
}

/**
 * Renders an error message for a human.
 *
 * @param message - The error message.
 * @param color - Whether to use ANSI color.
 * @returns The text to print.
 */
export function renderError(message: string, color: boolean): string {
  return colorize(`Error: ${message}`, 'red', color);
}

/**
 * Prints a command result to stdout.
 *
 * @param result - The result a command returned.
 */
export function printResult(result: CommandResult): void {
  console.log(renderResult(result, isColorEnabled(process.stdout)));
}

/**
 * Prints an error to stderr.
 *
 * @param message - The error message, printed with an `Error:` prefix.
 */
export function printError(message: string): void {
  console.error(renderError(message, isColorEnabled(process.stderr)));
}

/**
 * Prints a raw diagnostic (such as a stack trace) to stderr.
 *
 * @param text - The text to print.
 */
export function printDiagnostic(text: string): void {
  console.error(colorize(text, 'red', isColorEnabled(process.stderr)));
}

/**
 * Reports progress on stderr so stdout stays clean for results.
 *
 * @param message - What is currently happening.
 */
export function progress(message: string): void {
  console.error(message);
}
