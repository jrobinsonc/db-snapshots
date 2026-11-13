import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Question, SearchChoice } from 'inquirer';

import { createLoad } from '../../src/commands/load';
import { createMysqlDriver } from '../../src/drivers/mysql';
import type { LoadResult, Snapshot } from '../../src/types';
import { UserError } from '../../src/utils/exceptions';
import { CONFIG_FILE_NAME } from '../../src/utils/find-config-file';
import type { ProcessRunner, RunOptions } from '../../src/utils/process-runner';
import { formatSnapshotHeader } from '../../src/utils/snapshot-header';

interface RecordedRun {
  command: string[];
  stdinText?: string;
  stdinWasStream: boolean;
}

describe('commands/load', () => {
  let root: string;
  let storage: string;
  let tempRoot: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbs-')));
    storage = path.join(root, 'snapshots');
    tempRoot = path.join(root, 'tmp');
    fs.mkdirSync(tempRoot, { recursive: true });
    fs.writeFileSync(
      path.join(root, CONFIG_FILE_NAME),
      JSON.stringify({
        connections: {
          local: {
            driver: 'mysql',
            host: '127.0.0.1',
            user: 'root',
            database: 'app',
          },
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeSnapshot(name: string, body: string, created: Date): string {
    fs.mkdirSync(storage, { recursive: true });
    const file = path.join(storage, `${name}.sql`);
    const header = formatSnapshotHeader({
      driver: 'mysql',
      connection: 'local',
      created,
    });

    fs.writeFileSync(file, `${header}\n${body}`);

    return file;
  }

  function setup(options: {
    tablesOutput?: string;
    onPreflight?: (binary: string) => void;
    onRun?: (command: string[], runOptions: RunOptions) => Promise<void> | void;
    ask?: (questions: Question[]) => Promise<Record<string, unknown>>;
  }) {
    const preflighted: string[] = [];
    const runs: RecordedRun[] = [];
    const progressMessages: string[] = [];

    const runner: ProcessRunner = {
      preflight: (binary) => {
        preflighted.push(binary);
        options.onPreflight?.(binary);
      },
      run: async (command, runOptions = {}) => {
        if (options.onRun) {
          await options.onRun(command, runOptions);
        }

        const recorded: RecordedRun = {
          command,
          stdinWasStream: runOptions.stdin instanceof ReadableStream,
        };

        if (runOptions.stdin !== undefined) {
          recorded.stdinText = await new Response(runOptions.stdin).text();
        }

        runs.push(recorded);

        if (runOptions.stdout) {
          await runOptions.stdout(
            new Blob([options.tablesOutput ?? '']).stream(),
          );
        }

        return { stderr: '' };
      },
    };

    const driver = createMysqlDriver({ runner, tempDir: () => tempRoot });
    const load = createLoad({
      cwd: () => root,
      ask: (async (questions: Question[]) => {
        if (!options.ask) {
          throw new Error('unexpected prompt');
        }

        return options.ask(questions);
      }) as never,
      getDriver: () => driver,
      runner,
      progress: (message) => {
        progressMessages.push(message);
      },
    });

    return { load, preflighted, runs, progressMessages };
  }

  test('drops all tables and views before streaming the Snapshot into mysql', async () => {
    writeSnapshot(
      'baseline',
      'CREATE TABLE users (id INT);\n',
      new Date('2026-10-31T21:30:00Z'),
    );
    const { load, preflighted, runs, progressMessages } = setup({
      tablesOutput: 'active_users\tVIEW\nusers\tBASE TABLE\n',
    });

    const result = (await load({
      args: new Map([[0, 'baseline']]),
    })) as LoadResult;

    expect(preflighted).toEqual(['mysql']);
    expect(progressMessages).toEqual(['Loading Snapshot "baseline"...']);
    expect(runs).toHaveLength(2);

    const [dropQueryRun, loadRun] = runs;

    expect(
      dropQueryRun?.command.some((arg) => arg.startsWith('--execute=')),
    ).toBe(true);
    expect(loadRun?.command).toEqual([
      'mysql',
      '--host=127.0.0.1',
      '--user=root',
      'app',
    ]);
    expect(loadRun?.stdinWasStream).toBe(true);
    expect(loadRun?.stdinText).toBe(
      [
        'SET FOREIGN_KEY_CHECKS=0;',
        'DROP VIEW IF EXISTS `active_users`;',
        'DROP TABLE IF EXISTS `users`;',
        'SET FOREIGN_KEY_CHECKS=1;',
        '-- db-snapshots: driver=mysql connection=local created=2026-10-31T21:30:00Z',
        'CREATE TABLE users (id INT);',
        '',
      ].join('\n'),
    );
    expect(result).toMatchObject({
      kind: 'load',
      connection: 'local',
      dropped: true,
      snapshot: { name: 'baseline' },
    });
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('streams the Snapshot file directly when there are no tables or views to drop', async () => {
    writeSnapshot(
      'baseline',
      'CREATE TABLE users (id INT);\n',
      new Date('2026-10-31T21:30:00Z'),
    );
    const { load, runs } = setup({ tablesOutput: '' });

    const result = (await load({
      args: new Map([[0, 'baseline']]),
    })) as LoadResult;

    expect(runs).toHaveLength(2);
    expect(runs[1]?.stdinWasStream).toBe(false);
    expect(runs[1]?.stdinText).toBe(
      [
        '-- db-snapshots: driver=mysql connection=local created=2026-10-31T21:30:00Z',
        'CREATE TABLE users (id INT);',
        '',
      ].join('\n'),
    );
    expect(result.dropped).toBe(true);
  });

  test('prompts for a Snapshot sorted newest first when no name argument is given', async () => {
    writeSnapshot('older', 'SELECT 1;\n', new Date('2026-10-30T10:00:00Z'));
    writeSnapshot('newer', 'SELECT 2;\n', new Date('2026-10-31T10:00:00Z'));

    let offeredNames: string[] = [];
    let filteredNames: string[] = [];
    const { load, runs } = setup({
      tablesOutput: '',
      ask: async ([question]) => {
        const all = (await question?.source?.({}, undefined)) as SearchChoice[];
        const filtered = (await question?.source?.(
          {},
          'old',
        )) as SearchChoice[];

        offeredNames = all.map((choice) => choice.name);
        filteredNames = filtered.map((choice) => choice.name);

        return { picked: all[0]?.value as Snapshot };
      },
    });

    const result = (await load({ args: new Map() })) as LoadResult;

    expect(offeredNames).toEqual(['newer', 'older']);
    expect(filteredNames).toEqual(['older']);
    expect(result.snapshot.name).toBe('newer');
    expect(runs[1]?.stdinText).toContain('SELECT 2;');
  });

  test('fails with snapshot_not_found when the Snapshot or storage has no match', async () => {
    const { load, preflighted } = setup({});

    const missingNamed = await load({
      args: new Map([[0, 'missing']]),
    }).catch((caught: unknown) => caught);

    expect(missingNamed).toBeInstanceOf(UserError);
    expect((missingNamed as UserError).code).toBe('snapshot_not_found');

    const missingAny = await load({ args: new Map() }).catch(
      (caught: unknown) => caught,
    );

    expect(missingAny).toBeInstanceOf(UserError);
    expect((missingAny as UserError).code).toBe('snapshot_not_found');
    expect(preflighted).toEqual([]);
  });

  test('fails on missing binary preflight before running any client command', async () => {
    writeSnapshot('baseline', 'SELECT 1;\n', new Date('2026-10-31T21:30:00Z'));
    const { load, runs } = setup({
      onPreflight: (binary) => {
        throw new UserError(`Missing ${binary}`, 'missing_binary');
      },
    });

    const error = await load({ args: new Map([[0, 'baseline']]) }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toBe('missing_binary');
    expect(runs).toEqual([]);
  });

  test('wraps client_failed during drop or load (cancelling stream) and rethrows other errors', async () => {
    writeSnapshot('baseline', 'SELECT 1;\n', new Date('2026-10-31T21:30:00Z'));

    const dropFailure = setup({
      onRun: () => {
        throw new UserError('mysql failed: unknown database', 'client_failed');
      },
    });
    const dropError = await dropFailure
      .load({ args: new Map([[0, 'baseline']]) })
      .catch((caught: unknown) => caught);

    expect(dropError).toBeInstanceOf(UserError);
    expect((dropError as UserError).code).toBe('client_failed');
    expect((dropError as UserError).message).toContain('baseline');
    expect((dropError as UserError).message).toContain('local');
    expect((dropError as UserError).message).toContain('partially loaded');
    expect((dropError as UserError).message).toContain('unknown database');

    let canceledStream = false;
    const loadFailure = setup({
      tablesOutput: 'users\tBASE TABLE\n',
      onRun: async (_command, runOptions) => {
        if (runOptions.stdin instanceof ReadableStream) {
          await runOptions.stdin.cancel('client aborted');
          canceledStream = true;
          throw new UserError('mysql failed: syntax error', 'client_failed');
        }
      },
    });
    const loadError = await loadFailure
      .load({ args: new Map([[0, 'baseline']]) })
      .catch((caught: unknown) => caught);

    expect(canceledStream).toBe(true);
    expect(loadError).toBeInstanceOf(UserError);
    expect((loadError as UserError).code).toBe('client_failed');
    expect((loadError as UserError).message).toContain('syntax error');

    const unexpected = new Error('disk failure');
    const unexpectedFailure = setup({
      onRun: () => {
        throw unexpected;
      },
    });
    const caughtUnexpected = await unexpectedFailure
      .load({ args: new Map([[0, 'baseline']]) })
      .catch((caught: unknown) => caught);

    expect(caughtUnexpected).toBe(unexpected);
  });
});
