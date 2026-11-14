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

  function createHarness(
    askImpl?: (questions: Question[]) => Promise<Record<string, unknown>>,
  ) {
    const preflights: string[] = [];
    const runs: Array<{ command: string[]; stdinText: string }> = [];
    const dropAllCalls: number[] = [];
    const loadCalls: number[] = [];
    const asked: Question[][] = [];

    const runner: ProcessRunner = {
      preflight(binary) {
        preflights.push(binary);
      },
      async run(command, options: RunOptions = {}) {
        const stdinText =
          options.stdin === undefined
            ? ''
            : await new Response(options.stdin).text();

        runs.push({ command, stdinText });
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
        if (askImpl) {
          return (await askImpl(questions)) as Answers;
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
      createHarness(async (questions) => {
        const source = questions[0]?.source;
        const choices = (await source?.({}, '')) as SearchChoice[];
        const picked = choices[0]?.value as Snapshot;

        return { picked };
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
    const { load, preflights, runs, loadCalls } = createHarness();

    const result = (await load({
      args: new Map<string | number, unknown>([[0, 'mariadb_dump']]),
    })) as LoadResult;

    expect(preflights).toEqual(['mysql']);
    expect(loadCalls).toHaveLength(1);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.command).toEqual(['mysql', 'app']);
    expect(runs[0]?.stdinText).toContain(sql);
    expect(result).toMatchObject({
      kind: 'load',
      connection: 'local',
      dropped: false,
    });
    expect(result.snapshot.name).toBe('mariadb_dump');
    expect(result.snapshot.driver).toBe('mysql');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('skips the Driver check for headerless Snapshot files', async () => {
    const sql = 'CREATE TABLE legacy (id INT);\n';
    writeSnapshot('foreign_headerless', sql);
    const { load, preflights, runs, loadCalls } = createHarness();

    const result = (await load({
      args: new Map<string | number, unknown>([[0, 'foreign_headerless']]),
    })) as LoadResult;

    expect(preflights).toEqual(['mysql']);
    expect(loadCalls).toHaveLength(1);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.command).toEqual(['mysql', 'app']);
    expect(runs[0]?.stdinText).toBe(sql);
    expect(result.snapshot.driver).toBeNull();
    expect(result.connection).toBe('local');
  });
});
