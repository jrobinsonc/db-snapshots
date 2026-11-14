import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Question, SearchChoice } from 'inquirer';

import { createLoad } from '../../src/commands/load';
import { createMysqlDriver } from '../../src/drivers/mysql';
import type { Driver } from '../../src/drivers/types';
import type { LoadResult, Snapshot } from '../../src/types';
import { UserError } from '../../src/utils/exceptions';
import { CONFIG_FILE_NAME } from '../../src/utils/find-config-file';
import type { ProcessRunner, RunOptions } from '../../src/utils/process-runner';
import { formatSnapshotHeader } from '../../src/utils/snapshot-header';

const ENTRYPOINT = path.join(import.meta.dir, '..', '..', 'index.ts');

interface HarnessOptions {
  tablesOutput?: string;
  onPreflight?: (binary: string) => void;
  onRun?: (command: string[], options: RunOptions) => Promise<void> | void;
  ask?: (questions: Question[]) => Promise<Record<string, unknown>>;
}

interface RecordedRun {
  command: string[];
  stdinText: string;
  stdinWasStream: boolean;
}

describe('commands/load', () => {
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
    body: string,
    header?: { driver: string; connection: string; created: string },
  ): string {
    fs.mkdirSync(storage, { recursive: true });
    const file = path.join(storage, `${name}.sql`);
    const content = header
      ? `${formatSnapshotHeader({
          driver: header.driver,
          connection: header.connection,
          created: new Date(header.created),
        })}\n${body}`
      : body;

    fs.writeFileSync(file, content);
    return file;
  }

  function createHarness(harnessOptions: HarnessOptions = {}) {
    const preflights: string[] = [];
    const runs: RecordedRun[] = [];
    const dropAllCalls: number[] = [];
    const loadCalls: number[] = [];
    const asked: Question[][] = [];

    const runner: ProcessRunner = {
      preflight(binary) {
        preflights.push(binary);
        harnessOptions.onPreflight?.(binary);
      },
      async run(command, options: RunOptions = {}) {
        if (harnessOptions.onRun) {
          await harnessOptions.onRun(command, options);
        }

        const stdinWasStream = options.stdin instanceof ReadableStream;
        const stdinText =
          options.stdin === undefined
            ? ''
            : await new Response(options.stdin).text();

        runs.push({ command, stdinText, stdinWasStream });

        if (options.stdout) {
          await options.stdout(
            new Blob([harnessOptions.tablesOutput ?? '']).stream(),
          );
        }

        return { stderr: '' };
      },
    };

    const baseDriver = createMysqlDriver({ runner, tempDir: () => root });
    const driver: Driver = {
      ...baseDriver,
      async dropAllStatements(connection) {
        dropAllCalls.push(dropAllCalls.length + 1);
        return baseDriver.dropAllStatements(connection);
      },
      async load(connection, options) {
        loadCalls.push(loadCalls.length + 1);
        return baseDriver.load(connection, options);
      },
    };

    const load = createLoad({
      cwd: () => root,
      getDriver: () => driver,
      runner,
      ask: async <Answers>(questions: Question[]) => {
        asked.push(questions);
        if (harnessOptions.ask) {
          return (await harnessOptions.ask(questions)) as Answers;
        }
        throw new Error('Unexpected prompt in test');
      },
    });

    return {
      load,
      preflights,
      runs,
      dropAllCalls,
      loadCalls,
      asked,
    };
  }

  async function expectDriverMismatch(
    run: () => Promise<unknown>,
  ): Promise<UserError> {
    const error = await run().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toBe('driver_mismatch');
    return error as UserError;
  }

  test.each(['pgsql', 'sqlite'])(
    'refuses a %s Snapshot when loading into a mysql Connection before any preflight, drop, or load',
    async (snapshotDriver) => {
      writeSnapshot('foreign', 'SELECT 1;\n', {
        driver: snapshotDriver,
        connection: 'analytics',
        created: '2026-10-31T12:00:00Z',
      });
      const { load, preflights, runs, dropAllCalls, loadCalls, asked } =
        createHarness();

      const error = await expectDriverMismatch(() =>
        load({ args: new Map<string | number, unknown>([[0, 'foreign']]) }),
      );

      expect(error.message).toContain('foreign');
      expect(error.message).toContain(snapshotDriver);
      expect(error.message).toContain('local');
      expect(error.message).toContain('mysql');
      expect(preflights).toEqual([]);
      expect(runs).toEqual([]);
      expect(dropAllCalls).toEqual([]);
      expect(loadCalls).toEqual([]);
      expect(asked).toEqual([]);
    },
  );

  test('refuses a mismatched Snapshot selected from the interactive picker before any preflight, drop, or load', async () => {
    writeSnapshot('pg_backup', 'SELECT 1;\n', {
      driver: 'pgsql',
      connection: 'analytics',
      created: '2026-10-31T12:00:00Z',
    });

    const { load, preflights, runs, dropAllCalls, loadCalls, asked } =
      createHarness({
        ask: async (questions) => {
          const source = questions[0]?.source;
          const choices = (await source?.({}, '')) as SearchChoice[];
          const picked = choices[0]?.value as Snapshot;

          return { picked };
        },
      });

    const error = await expectDriverMismatch(() => load({ args: new Map() }));

    expect(error.message).toContain('pg_backup');
    expect(error.message).toContain('pgsql');
    expect(asked).toHaveLength(1);
    expect(preflights).toEqual([]);
    expect(runs).toEqual([]);
    expect(dropAllCalls).toEqual([]);
    expect(loadCalls).toEqual([]);
  });

  test('has no override: never prompts and ignores force=true', async () => {
    writeSnapshot('pg_backup', 'SELECT 1;\n', {
      driver: 'pgsql',
      connection: 'analytics',
      created: '2026-10-31T12:00:00Z',
    });
    const { load, preflights, runs, dropAllCalls, loadCalls, asked } =
      createHarness();

    const error = await expectDriverMismatch(() =>
      load({
        args: new Map<string | number, unknown>([
          [0, 'pg_backup'],
          ['force', true],
        ]),
      }),
    );

    expect(error.code).toBe('driver_mismatch');
    expect(asked).toEqual([]);
    expect(preflights).toEqual([]);
    expect(runs).toEqual([]);
    expect(dropAllCalls).toEqual([]);
    expect(loadCalls).toEqual([]);
  });

  test('CLI exits with code 1 and prints the driver mismatch error to stderr', () => {
    writeSnapshot('pg_backup', 'SELECT 1;\n', {
      driver: 'pgsql',
      connection: 'analytics',
      created: '2026-10-31T12:00:00Z',
    });

    const result = Bun.spawnSync(['bun', ENTRYPOINT, 'load', 'pg_backup'], {
      cwd: root,
      stdin: 'ignore',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toContain('Error:');
    expect(result.stderr.toString()).toContain('pg_backup');
    expect(result.stderr.toString()).toContain('pgsql');
    expect(result.stderr.toString()).toContain('mysql');
  });

  test('allows a Snapshot with the mysql Driver (shared by MySQL and MariaDB) and streams it', async () => {
    const sql = 'CREATE TABLE items (id INT);\n';
    writeSnapshot('mariadb_dump', sql, {
      driver: 'mysql',
      connection: 'mariadb_local',
      created: '2026-10-31T12:00:00Z',
    });
    const { load, preflights, runs, dropAllCalls, loadCalls } = createHarness();

    const result = (await load({
      args: new Map<string | number, unknown>([[0, 'mariadb_dump']]),
    })) as LoadResult;

    expect(preflights).toEqual(['mysql']);
    expect(dropAllCalls).toHaveLength(1);
    expect(loadCalls).toHaveLength(1);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.command).toEqual(['mysql', 'app']);
    expect(runs[1]?.stdinWasStream).toBe(false);
    expect(runs[1]?.stdinText).toContain(sql);
    expect(result).toMatchObject({
      kind: 'load',
      connection: 'local',
      dropped: true,
    });
    expect(result.snapshot.name).toBe('mariadb_dump');
    expect(result.snapshot.driver).toBe('mysql');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('skips the Driver check for headerless Snapshot files', async () => {
    const sql = 'CREATE TABLE legacy (id INT);\n';
    writeSnapshot('foreign_headerless', sql);
    const { load, preflights, runs, dropAllCalls, loadCalls } = createHarness();

    const result = (await load({
      args: new Map<string | number, unknown>([[0, 'foreign_headerless']]),
    })) as LoadResult;

    expect(preflights).toEqual(['mysql']);
    expect(dropAllCalls).toHaveLength(1);
    expect(loadCalls).toHaveLength(1);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.command).toEqual(['mysql', 'app']);
    expect(runs[1]?.stdinWasStream).toBe(false);
    expect(runs[1]?.stdinText).toBe(sql);
    expect(result.snapshot.driver).toBeNull();
    expect(result.connection).toBe('local');
    expect(result.dropped).toBe(true);
  });

  test('drops all tables and views before streaming the Snapshot into mysql', async () => {
    writeSnapshot('baseline', 'CREATE TABLE users (id INT);\n', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T21:30:00Z',
    });
    const { load, preflights, runs, dropAllCalls, loadCalls } = createHarness({
      tablesOutput: 'active_users\tVIEW\nusers\tBASE TABLE\n',
    });

    const result = (await load({
      args: new Map([[0, 'baseline']]),
    })) as LoadResult;

    expect(preflights).toEqual(['mysql']);
    expect(dropAllCalls).toHaveLength(1);
    expect(loadCalls).toHaveLength(1);
    expect(runs).toHaveLength(2);

    const [dropQueryRun, loadRun] = runs;

    expect(
      dropQueryRun?.command.some((arg) => arg.startsWith('--execute=')),
    ).toBe(true);
    expect(loadRun?.command).toEqual(['mysql', 'app']);
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

  test('prompts for a Snapshot sorted newest first when no name argument is given', async () => {
    writeSnapshot('older', 'SELECT 1;\n', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-30T10:00:00Z',
    });
    writeSnapshot('newer', 'SELECT 2;\n', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });

    let offeredNames: string[] = [];
    let filteredNames: string[] = [];
    const { load, runs } = createHarness({
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
    const { load, preflights } = createHarness();

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
    expect(preflights).toEqual([]);
  });

  test('fails on missing binary preflight before running any client command', async () => {
    writeSnapshot('baseline', 'SELECT 1;\n', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T21:30:00Z',
    });
    const { load, runs } = createHarness({
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
    writeSnapshot('baseline', 'SELECT 1;\n', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T21:30:00Z',
    });

    const dropFailure = createHarness({
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
    const loadFailure = createHarness({
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
    const unexpectedFailure = createHarness({
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
