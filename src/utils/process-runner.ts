import { UserError } from './exceptions';

/** How a client process is wired up. */
export interface RunOptions {
  /** Streamed into the process's stdin. A `Bun.file()` streams that file. */
  stdin?: Blob | ReadableStream<Uint8Array>;
  /**
   * Receives the process's stdout as a stream. It must consume the stream;
   * the run settles only after it does. Without it, stdout is discarded.
   */
  stdout?: (output: ReadableStream<Uint8Array>) => Promise<unknown>;
  /** Variables added to the inherited environment. */
  env?: Record<string, string>;
}

/** What a successful run reports. */
export interface RunResult {
  /** Everything the process wrote to stderr (warnings, notes). */
  stderr: string;
}

/** The single seam around process spawning. Tests replace it. */
export interface ProcessRunner {
  /**
   * Checks a binary is available, before any database interaction.
   *
   * @param binary - The binary to look for.
   * @throws {UserError} with code `missing_binary` when it cannot be found.
   */
  preflight(binary: string): void;
  /**
   * Runs a command to completion. No timeout is applied.
   *
   * @param command - The binary followed by its arguments. No shell is used.
   * @param options - stdin/stdout wiring.
   * @returns The captured stderr.
   * @throws {UserError} with code `missing_binary` when the binary cannot
   *   be spawned, or `client_failed` when it exits with a non-zero status,
   *   carrying its stderr.
   */
  run(command: string[], options?: RunOptions): Promise<RunResult>;
}

/** A spawned process, as far as the runner uses it. */
interface SpawnedProcess {
  stdout: ReadableStream<Uint8Array> | number | undefined;
  stderr: ReadableStream<Uint8Array> | number | undefined;
  exited: Promise<number>;
  kill(): void;
}

interface RunnerDeps {
  /** Resolves a binary to its path, or null when it is not found. */
  which: (binary: string) => string | null;
  /** Spawns a process with the given wiring. */
  spawn: (
    command: string[],
    options: {
      stdin: Blob | ReadableStream<Uint8Array> | 'ignore';
      stdout: 'pipe' | 'ignore';
      env: Record<string, string>;
    },
  ) => SpawnedProcess;
}

/**
 * Builds a process runner.
 *
 * @param deps - Overridable collaborators, for tests.
 * @returns The runner.
 */
export function createRunner(deps: RunnerDeps): ProcessRunner {
  return {
    preflight(binary) {
      if (deps.which(binary) === null) {
        throw missingBinary(binary);
      }
    },

    async run(command, options = {}) {
      const binary = command[0] ?? 'client';
      let proc: SpawnedProcess;

      try {
        proc = deps.spawn(command, {
          stdin: options.stdin ?? 'ignore',
          stdout: options.stdout ? 'pipe' : 'ignore',
          env: options.env ?? {},
        });
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') {
          throw missingBinary(binary);
        }

        throw error;
      }

      const consumeStdout =
        options.stdout && proc.stdout instanceof ReadableStream
          ? options.stdout(proc.stdout)
          : undefined;

      // Drain both streams while the process runs so neither pipe fills up.
      let stderr: string;
      let exitCode: number;

      try {
        [stderr, exitCode] = await Promise.all([
          readText(proc.stderr),
          proc.exited,
          consumeStdout,
        ]);
      } catch (error) {
        // The stdout consumer failed (for example, a full disk): stop the client.
        proc.kill();

        throw error;
      }

      if (exitCode !== 0) {
        const detail = stderr.trim();

        throw new UserError(
          detail === ''
            ? `${binary} exited with status ${exitCode}`
            : `${binary} failed: ${detail}`,
          'client_failed',
        );
      }

      return { stderr };
    },
  };
}

/**
 * Builds the error for a binary that cannot be found.
 *
 * @param binary - The binary that was looked for.
 * @returns The user error.
 */
function missingBinary(binary: string): UserError {
  return new UserError(
    `Required client binary "${binary}" was not found in PATH. Install it and try again.`,
    'missing_binary',
  );
}

/**
 * Reads a process stream fully as text.
 *
 * @param stream - The stream, or a non-stream when it was not piped.
 * @returns Its contents, or an empty string.
 */
async function readText(
  stream: ReadableStream<Uint8Array> | number | undefined,
): Promise<string> {
  return stream instanceof ReadableStream ? new Response(stream).text() : '';
}

/** The runner every command uses. */
export const runner: ProcessRunner = createRunner({
  which: (binary) => Bun.which(binary),
  spawn: (command, { env, ...options }) =>
    Bun.spawn(command, {
      ...options,
      env: { ...process.env, ...env },
      stderr: 'pipe',
    }),
});
