import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Snapshot } from '../types';
import describeSnapshot from './describe-snapshot';
import { UserError } from './exceptions';
import { progress as defaultProgress } from './output';
import { ask as promptAsk } from './prompt';
import { readSnapshotHeader } from './snapshot-header';

const SNAPSHOT_EXTENSION = '.sql';

export interface SnapshotResolverDeps {
  /** The prompt helper's `ask`. */
  ask: typeof promptAsk;
  /** Reports progress on stderr. */
  progress?: typeof defaultProgress;
}

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

/**
 * Prompts the user to pick a Snapshot from `candidates` using an
 * autocomplete search prompt defaulting to the first (newest) candidate.
 *
 * @param candidates - Candidate Snapshots, sorted newest first.
 * @param ask - The prompt helper.
 * @returns The picked Snapshot.
 */
async function pickSnapshot(
  candidates: Snapshot[],
  ask: typeof promptAsk,
): Promise<Snapshot> {
  const { picked } = await ask<{ picked: Snapshot }>([
    {
      type: 'search',
      name: 'picked',
      message: 'Select the Snapshot:',
      default: candidates[0],
      source: (first?: unknown, second?: string) => {
        const term =
          typeof first === 'string'
            ? first
            : typeof second === 'string'
              ? second
              : '';

        return candidates
          .filter((snapshot) => snapshot.name.includes(term))
          .map((snapshot) => ({ name: snapshot.name, value: snapshot }));
      },
    },
  ]);

  return picked;
}

/**
 * Builds the Snapshot resolver used by `load` and `delete`.
 *
 * @param deps - Overridable collaborators, for tests.
 * @returns The resolver.
 */
export function createSnapshotResolver(deps: SnapshotResolverDeps) {
  const reportProgress = deps.progress ?? defaultProgress;

  /**
   * Resolves a Snapshot by exact name, substring match, or interactive picker.
   *
   * @param storage - The Snapshot Storage directory.
   * @param name - The Snapshot Name or partial name, when given.
   * @returns The resolved Snapshot.
   * @throws {UserError} with code `snapshot_not_found`, `ambiguous_snapshot`,
   *   or `input_required`.
   */
  return async function resolveSnapshot(
    storage: string,
    name?: string,
  ): Promise<Snapshot> {
    if (name === undefined) {
      // Newest first, so the picker opens on the latest Snapshot.
      const snapshots = await listSnapshots(storage);

      if (snapshots.length === 0) {
        throw new UserError(
          `No Snapshots found in ${storage}.`,
          'snapshot_not_found',
        );
      }

      return pickSnapshot(snapshots, deps.ask);
    }

    const exact = await findSnapshot(storage, name);

    if (exact) {
      return exact;
    }

    const snapshots = await listSnapshots(storage);
    const matches =
      name.length === 0
        ? []
        : snapshots.filter((snapshot) => snapshot.name.includes(name));
    const [firstMatch, secondMatch] = matches;

    if (firstMatch === undefined) {
      throw new UserError(
        `Snapshot "${name}" was not found in ${storage}.`,
        'snapshot_not_found',
      );
    }

    if (secondMatch === undefined) {
      reportProgress(`Resolved "${name}" to Snapshot "${firstMatch.name}".`);

      return firstMatch;
    }

    try {
      return await pickSnapshot(matches, deps.ask);
    } catch (error) {
      if (error instanceof UserError && error.code === 'input_required') {
        const candidates = matches.map((snapshot) => snapshot.name);

        throw new UserError(
          `Snapshot "${name}" matches multiple Snapshots: ${candidates.join(', ')}.`,
          'ambiguous_snapshot',
          candidates,
        );
      }

      throw error;
    }
  };
}

/** Resolves a Snapshot from Snapshot Storage, prompting through the real prompt helper. */
export const resolveSnapshot = createSnapshotResolver({ ask: promptAsk });
