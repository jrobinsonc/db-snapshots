import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Question, SearchChoice } from 'inquirer';

import { createDelete } from '../../src/commands/delete';
import type { DeleteResult, Snapshot } from '../../src/types';
import { UserError } from '../../src/utils/exceptions';
import { CONFIG_FILE_NAME } from '../../src/utils/find-config-file';
import { formatSnapshotHeader } from '../../src/utils/snapshot-header';

const ENTRYPOINT = path.join(import.meta.dir, '..', '..', 'index.ts');

interface HarnessOptions {
  ask?: (questions: Question[]) => Promise<Record<string, unknown>>;
  confirm?: (message: string) => Promise<boolean>;
  omitProgress?: boolean;
}

describe('commands/delete', () => {
  let root: string;
  let storage: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbs-')));
    storage = path.join(root, 'snapshots');
    fs.writeFileSync(
      path.join(root, CONFIG_FILE_NAME),
      JSON.stringify({
        connections: {
          local: { driver: 'mysql', database: 'app' },
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
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

  function createHarness(options: HarnessOptions = {}) {
    const asked: Question[][] = [];
    const confirmations: string[] = [];
    const progressMessages: string[] = [];

    const del = createDelete({
      cwd: () => root,
      progress: options.omitProgress
        ? undefined
        : (message) => {
            progressMessages.push(message);
          },
      ask: async <Answers>(questions: Question[]) => {
        asked.push(questions);
        if (options.ask) {
          return (await options.ask(questions)) as Answers;
        }
        throw new Error('Unexpected prompt in test');
      },
      confirm: async (message: string) => {
        confirmations.push(message);
        if (options.confirm) {
          return options.confirm(message);
        }
        throw new Error('Unexpected confirmation in test');
      },
    });

    return { del, asked, confirmations, progressMessages };
  }

  test('exact match deletes the Snapshot and wins over substring matches without prompting or printing a resolution note', async () => {
    const exactFile = writeSnapshot('app', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-30T10:00:00Z',
    });
    const otherFile = writeSnapshot('app_2026-10-31', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });

    const { del, asked, confirmations, progressMessages } = createHarness();
    const result = (await del({
      args: new Map([[0, 'app']]),
    })) as DeleteResult;

    expect(asked).toEqual([]);
    expect(confirmations).toEqual([]);
    expect(progressMessages).toEqual([]);
    expect(result).toMatchObject({
      kind: 'delete',
      deleted: { name: 'app', file: exactFile },
    });
    expect(fs.existsSync(exactFile)).toBe(false);
    expect(fs.existsSync(otherFile)).toBe(true);
  });

  test('single substring match prints the resolved name, confirms, and deletes the file when confirmed', async () => {
    const baselineFile = writeSnapshot('baseline', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-30T10:00:00Z',
    });
    const targetFile = writeSnapshot('local_2026-10-31_21-30-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T21:30:00Z',
    });

    const { del, asked, confirmations, progressMessages } = createHarness({
      confirm: async () => true,
    });
    const result = (await del({
      args: new Map([[0, '2026-10-31']]),
    })) as DeleteResult;

    expect(asked).toEqual([]);
    expect(progressMessages).toEqual([
      'Resolved "2026-10-31" to Snapshot "local_2026-10-31_21-30-00".',
    ]);
    expect(confirmations).toEqual([
      'Delete Snapshot "local_2026-10-31_21-30-00"?',
    ]);
    expect(result).toMatchObject({
      kind: 'delete',
      deleted: { name: 'local_2026-10-31_21-30-00', file: targetFile },
    });
    expect(fs.existsSync(targetFile)).toBe(false);
    expect(fs.existsSync(baselineFile)).toBe(true);
  });

  test('single substring match reports via default progress helper when progress is omitted', async () => {
    const targetFile = writeSnapshot('local_2026-10-31_21-30-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T21:30:00Z',
    });

    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { del } = createHarness({
        omitProgress: true,
        confirm: async () => true,
      });

      const result = (await del({
        args: new Map([[0, '21-30']]),
      })) as DeleteResult;

      expect(result.deleted.name).toBe('local_2026-10-31_21-30-00');
      expect(fs.existsSync(targetFile)).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        'Resolved "21-30" to Snapshot "local_2026-10-31_21-30-00".',
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('single substring match leaves the Snapshot on disk and returns undefined when confirmation is declined', async () => {
    const targetFile = writeSnapshot('local_2026-10-31_21-30-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T21:30:00Z',
    });

    const { del, confirmations } = createHarness({
      confirm: async () => false,
    });
    const result = await del({
      args: new Map([[0, '2026-10-31']]),
    });

    expect(confirmations).toEqual([
      'Delete Snapshot "local_2026-10-31_21-30-00"?',
    ]);
    expect(result).toBeUndefined();
    expect(fs.existsSync(targetFile)).toBe(true);
  });

  test('multiple substring matches open a filtered picker sorted newest first with newest as default, then confirm before deleting', async () => {
    const unrelatedFile = writeSnapshot('unrelated', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-11-01T10:00:00Z',
    });
    const olderFile = writeSnapshot('local_2026-10-30_10-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-30T10:00:00Z',
    });
    const newerFile = writeSnapshot('local_2026-10-31_10-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });

    let offeredNames: string[] = [];
    let filteredNames: string[] = [];
    let defaultChoice: Snapshot | undefined;
    const { del, confirmations } = createHarness({
      ask: async ([question]) => {
        defaultChoice = question?.default as Snapshot | undefined;
        const all = (await question?.source?.(undefined)) as SearchChoice[];
        const filtered = (await question?.source?.('10-30')) as SearchChoice[];

        offeredNames = all.map((choice) => choice.name);
        filteredNames = filtered.map((choice) => choice.name);

        return { picked: filtered[0]?.value as Snapshot };
      },
      confirm: async () => true,
    });

    const result = (await del({
      args: new Map([[0, 'local_2026-10']]),
    })) as DeleteResult;

    expect(offeredNames).toEqual([
      'local_2026-10-31_10-00-00',
      'local_2026-10-30_10-00-00',
    ]);
    expect(defaultChoice?.name).toBe('local_2026-10-31_10-00-00');
    expect(filteredNames).toEqual(['local_2026-10-30_10-00-00']);
    expect(confirmations).toEqual([
      'Delete Snapshot "local_2026-10-30_10-00-00"?',
    ]);
    expect(result).toMatchObject({
      kind: 'delete',
      deleted: { name: 'local_2026-10-30_10-00-00', file: olderFile },
    });
    expect(fs.existsSync(olderFile)).toBe(false);
    expect(fs.existsSync(newerFile)).toBe(true);
    expect(fs.existsSync(unrelatedFile)).toBe(true);
  });

  test('multiple substring matches in noninteractive mode fail with ambiguous_snapshot listing candidates and leave files intact', async () => {
    const file1 = writeSnapshot('local_2026-10-30_10-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-30T10:00:00Z',
    });
    const file2 = writeSnapshot('local_2026-10-31_10-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });

    const { del, confirmations } = createHarness({
      ask: () => {
        throw new UserError(
          'Input required but stdin is not a terminal: Select the Snapshot:',
          'input_required',
        );
      },
    });

    const error = await del({
      args: new Map([[0, 'local_2026']]),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toBe('ambiguous_snapshot');
    expect((error as UserError).candidates).toEqual([
      'local_2026-10-31_10-00-00',
      'local_2026-10-30_10-00-00',
    ]);
    expect(confirmations).toEqual([]);
    expect(fs.existsSync(file1)).toBe(true);
    expect(fs.existsSync(file2)).toBe(true);
  });

  test('no name opens an autocomplete picker sorted newest first with newest as default and deletes without an extra confirmation', async () => {
    const olderFile = writeSnapshot('older', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-30T10:00:00Z',
    });
    const newerFile = writeSnapshot('newer', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });

    let offeredNames: string[] = [];
    let defaultChoice: Snapshot | undefined;
    const { del, confirmations } = createHarness({
      ask: async ([question]) => {
        defaultChoice = question?.default as Snapshot | undefined;
        const all = (await question?.source?.(undefined)) as SearchChoice[];
        offeredNames = all.map((choice) => choice.name);

        return { picked: all[0]?.value as Snapshot };
      },
    });

    const result = (await del({ args: new Map() })) as DeleteResult;

    expect(offeredNames).toEqual(['newer', 'older']);
    expect(defaultChoice?.name).toBe('newer');
    expect(confirmations).toEqual([]);
    expect(result).toMatchObject({
      kind: 'delete',
      deleted: { name: 'newer', file: newerFile },
    });
    expect(fs.existsSync(newerFile)).toBe(false);
    expect(fs.existsSync(olderFile)).toBe(true);
  });

  test('no name in noninteractive mode fails with input_required', async () => {
    const file = writeSnapshot('baseline', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });

    const { del } = createHarness({
      ask: () => {
        throw new UserError(
          'Input required but stdin is not a terminal: Select the Snapshot:',
          'input_required',
        );
      },
    });

    const error = await del({ args: new Map() }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toBe('input_required');
    expect(fs.existsSync(file)).toBe(true);
  });

  test('fails with snapshot_not_found when the Snapshot, empty name, or storage has no match', async () => {
    const { del } = createHarness();

    const missingNamed = await del({
      args: new Map([[0, 'missing']]),
    }).catch((caught: unknown) => caught);

    expect(missingNamed).toBeInstanceOf(UserError);
    expect((missingNamed as UserError).code).toBe('snapshot_not_found');

    writeSnapshot('baseline');

    const missingEmpty = await del({
      args: new Map([[0, '']]),
    }).catch((caught: unknown) => caught);

    expect(missingEmpty).toBeInstanceOf(UserError);
    expect((missingEmpty as UserError).code).toBe('snapshot_not_found');

    fs.rmSync(storage, { recursive: true, force: true });

    const missingAny = await del({ args: new Map() }).catch(
      (caught: unknown) => caught,
    );

    expect(missingAny).toBeInstanceOf(UserError);
    expect((missingAny as UserError).code).toBe('snapshot_not_found');
  });

  test('never touches the database: ignores unresolved multiple Connections, foreign Drivers, and headerless Snapshots', async () => {
    fs.writeFileSync(
      path.join(root, CONFIG_FILE_NAME),
      JSON.stringify({
        connections: {
          primary: { driver: 'mysql', database: 'app' },
          secondary: { driver: 'mysql', database: 'analytics' },
        },
      }),
    );

    const foreignFile = writeSnapshot('pg_backup', {
      driver: 'pgsql',
      connection: 'analytics',
      created: '2026-10-31T12:00:00Z',
    });
    const headerlessFile = writeSnapshot('legacy_dump');

    const { del, asked } = createHarness();

    const deletedForeign = (await del({
      args: new Map([[0, 'pg_backup']]),
    })) as DeleteResult;
    const deletedHeaderless = (await del({
      args: new Map([[0, 'legacy_dump']]),
    })) as DeleteResult;

    expect(asked).toEqual([]);
    expect(deletedForeign.deleted.name).toBe('pg_backup');
    expect(deletedHeaderless.deleted.name).toBe('legacy_dump');
    expect(fs.existsSync(foreignFile)).toBe(false);
    expect(fs.existsSync(headerlessFile)).toBe(false);
  });

  test('CLI deletes an exact match, prints the deleted Snapshot Name to stdout, and exits 0', () => {
    const file = writeSnapshot('baseline', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T21:30:00Z',
    });

    const result = Bun.spawnSync(['bun', ENTRYPOINT, 'delete', 'baseline'], {
      cwd: root,
      stdin: 'ignore',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe('Snapshot deleted: baseline');
    expect(result.stderr.toString()).toBe('');
    expect(fs.existsSync(file)).toBe(false);
  });

  test('CLI fails when noninteractive on substring confirmation, ambiguous match, or missing name', () => {
    const olderFile = writeSnapshot('local_older', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-30T10:00:00Z',
    });
    const newerFile = writeSnapshot('local_newer', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });

    const singleSubstring = Bun.spawnSync(
      ['bun', ENTRYPOINT, 'delete', 'older'],
      {
        cwd: root,
        stdin: 'ignore',
      },
    );

    expect(singleSubstring.exitCode).toBe(1);
    expect(singleSubstring.stdout.toString()).toBe('');
    expect(singleSubstring.stderr.toString()).toContain('Input required');
    expect(singleSubstring.stderr.toString()).toContain(
      'Delete Snapshot "local_older"?',
    );
    expect(fs.existsSync(olderFile)).toBe(true);

    const ambiguous = Bun.spawnSync(['bun', ENTRYPOINT, 'delete', 'local'], {
      cwd: root,
      stdin: 'ignore',
    });

    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.stdout.toString()).toBe('');
    expect(ambiguous.stderr.toString()).toContain('local_newer');
    expect(ambiguous.stderr.toString()).toContain('local_older');
    expect(fs.existsSync(olderFile)).toBe(true);
    expect(fs.existsSync(newerFile)).toBe(true);

    const missingName = Bun.spawnSync(['bun', ENTRYPOINT, 'delete'], {
      cwd: root,
      stdin: 'ignore',
    });

    expect(missingName.exitCode).toBe(1);
    expect(missingName.stdout.toString()).toBe('');
    expect(missingName.stderr.toString()).toContain('Error:');
    expect(missingName.stderr.toString()).toContain('Select the Snapshot:');
    expect(fs.existsSync(olderFile)).toBe(true);
    expect(fs.existsSync(newerFile)).toBe(true);
  });
});
