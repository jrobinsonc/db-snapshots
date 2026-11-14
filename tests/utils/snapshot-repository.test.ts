import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Question, SearchChoice } from 'inquirer';

import type { Snapshot } from '../../src/types';
import { UserError } from '../../src/utils/exceptions';
import { formatSnapshotHeader } from '../../src/utils/snapshot-header';
import {
  createSnapshotResolver,
  findSnapshot,
  listSnapshots,
} from '../../src/utils/snapshot-repository';

describe('utils/snapshot-repository', () => {
  let storage: string;

  beforeEach(() => {
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbs-')));
  });

  afterEach(() => {
    fs.rmSync(storage, { recursive: true, force: true });
  });

  function writeSnapshot(
    name: string,
    header?: { driver: string; connection: string; created: string },
  ): string {
    fs.mkdirSync(storage, { recursive: true });
    const file = path.join(storage, `${name}.sql`);
    const content = header
      ? `${formatSnapshotHeader({
          driver: header.driver,
          connection: header.connection,
          created: new Date(header.created),
        })}\nSELECT 1;\n`
      : 'SELECT 1;\n';

    fs.writeFileSync(file, content);
    return file;
  }

  test('ignores missing storage, non-sql files, and subdirectories, and orders newest first with alphabetical tie-breaking', async () => {
    const missing = path.join(storage, 'does-not-exist');
    expect(await listSnapshots(missing)).toEqual([]);
    expect(await findSnapshot(missing, 'anything')).toBeUndefined();

    fs.writeFileSync(path.join(storage, 'notes.txt'), 'ignore me');
    fs.mkdirSync(path.join(storage, 'nested.sql'));
    writeSnapshot('zeta', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });
    writeSnapshot('alpha', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });
    writeSnapshot('newest', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T12:00:00Z',
    });

    const snapshots = await listSnapshots(storage);
    expect(snapshots.map((snapshot) => snapshot.name)).toEqual([
      'newest',
      'alpha',
      'zeta',
    ]);
    expect(await findSnapshot(storage, 'alpha')).toMatchObject({
      name: 'alpha',
    });
    expect(await findSnapshot(storage, 'missing')).toBeUndefined();
  });

  test('exact match wins over substring matches without prompting or reporting resolution', async () => {
    writeSnapshot('prod', {
      driver: 'mysql',
      connection: 'prod',
      created: '2026-10-30T10:00:00Z',
    });
    writeSnapshot('prod_2026-10-31', {
      driver: 'mysql',
      connection: 'prod',
      created: '2026-10-31T10:00:00Z',
    });

    const messages: string[] = [];
    const asked: Question[][] = [];
    const resolveSnapshot = createSnapshotResolver({
      progress: (message) => messages.push(message),
      ask: async (questions) => {
        asked.push(questions);
        throw new Error('Unexpected prompt');
      },
    });

    const snapshot = await resolveSnapshot(storage, 'prod');

    expect(snapshot.name).toBe('prod');
    expect(asked).toEqual([]);
    expect(messages).toEqual([]);
  });

  test('single substring match resolves and reports via default progress helper when progress is omitted', async () => {
    writeSnapshot('local_2026-10-31_21-30-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T21:30:00Z',
    });
    writeSnapshot('baseline', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-30T10:00:00Z',
    });

    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const resolveSnapshot = createSnapshotResolver({
        ask: async () => {
          throw new Error('Unexpected prompt');
        },
      });

      const snapshot = await resolveSnapshot(storage, '21-30');

      expect(snapshot.name).toBe('local_2026-10-31_21-30-00');
      expect(errorSpy).toHaveBeenCalledWith(
        'Resolved "21-30" to Snapshot "local_2026-10-31_21-30-00".',
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('multiple substring matches open a filtered picker sorted newest first with newest as default', async () => {
    writeSnapshot('other', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-11-01T10:00:00Z',
    });
    writeSnapshot('release_1', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-30T10:00:00Z',
    });
    writeSnapshot('release_2', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });

    let defaultCandidate: Snapshot | undefined;
    let initialChoices: SearchChoice[] = [];
    let filteredChoices: SearchChoice[] = [];
    const resolveSnapshot = createSnapshotResolver({
      progress: () => {},
      ask: async ([question]) => {
        defaultCandidate = question?.default as Snapshot | undefined;
        initialChoices = (await question?.source?.(
          undefined,
        )) as SearchChoice[];
        filteredChoices = (await question?.source?.('_1')) as SearchChoice[];
        return { picked: filteredChoices[0]?.value as Snapshot } as never;
      },
    });

    const snapshot = await resolveSnapshot(storage, 'release');

    expect(defaultCandidate?.name).toBe('release_2');
    expect(initialChoices.map((choice) => choice.name)).toEqual([
      'release_2',
      'release_1',
    ]);
    expect(filteredChoices.map((choice) => choice.name)).toEqual(['release_1']);
    expect(snapshot.name).toBe('release_1');
  });

  test('multiple substring matches in noninteractive mode fail with ambiguous_snapshot and candidates', async () => {
    writeSnapshot('release_1', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-30T10:00:00Z',
    });
    writeSnapshot('release_2', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });

    const resolveSnapshot = createSnapshotResolver({
      ask: async () => {
        throw new UserError('stdin is not a terminal', 'input_required');
      },
    });

    const error = await resolveSnapshot(storage, 'release').catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toBe('ambiguous_snapshot');
    expect((error as UserError).candidates).toEqual(['release_2', 'release_1']);
    expect((error as UserError).message).toContain('release_2, release_1');
  });

  test('no match and empty name fail with snapshot_not_found; no name fails with input_required when noninteractive', async () => {
    writeSnapshot('baseline', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });

    const resolveSnapshot = createSnapshotResolver({
      ask: async () => {
        throw new UserError('stdin is not a terminal', 'input_required');
      },
    });

    const missing = await resolveSnapshot(storage, 'unknown').catch(
      (caught: unknown) => caught,
    );
    expect(missing).toBeInstanceOf(UserError);
    expect((missing as UserError).code).toBe('snapshot_not_found');

    const empty = await resolveSnapshot(storage, '').catch(
      (caught: unknown) => caught,
    );
    expect(empty).toBeInstanceOf(UserError);
    expect((empty as UserError).code).toBe('snapshot_not_found');

    const noName = await resolveSnapshot(storage).catch(
      (caught: unknown) => caught,
    );
    expect(noName).toBeInstanceOf(UserError);
    expect((noName as UserError).code).toBe('input_required');
  });
});
