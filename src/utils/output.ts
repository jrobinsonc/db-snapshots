import type { CommandResult } from '../types';

type Color = 'red' | 'green' | 'yellow';

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
