import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCreate } from '../../src/commands/create';
import type { Driver, DumpOptions } from '../../src/drivers/types';
import { UserError } from '../../src/utils/exceptions';
import { CONFIG_FILE_NAME } from '../../src/utils/find-config-file';
import type { ConnectionConfig } from '../../src/utils/load-config';
import type { ProcessRunner } from '../../src/utils/process-runner';
import { parseSnapshotHeader } from '../../src/utils/snapshot-header';

/** A fixed local-time instant: 31 Oct 2026, 21:30:00. */
const NOW = new Date(2026, 9, 31, 21, 30, 0);

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body as ReadableStream<Uint8Array>;
}

const unused = (): never => {
  throw new Error('not used by create');
};

interface HarnessOptions {
  root: string;
  dumpBody?: string;
  confirmAnswer?: boolean;
  preflightError?: Error;
}

function createHarness(options: HarnessOptions) {
  const preflights: string[] = [];
  const confirmations: string[] = [];
  const dumps: ConnectionConfig[] = [];

  const runner: ProcessRunner = {
    preflight(binary) {
      preflights.push(binary);
      if (options.preflightError) {
        throw options.preflightError;
      }
    },
    run: unused as ProcessRunner['run'],
  };

  const driver: Driver = {
    name: 'mysql',
    binaries: { dump: 'mysqldump', load: 'mysql' },
    defaultDumpFlags: async () => [],
    withCredentials: unused,
    listTables: unused,
    dropAllStatements: unused,
    load: unused,
    async dump(connection: ConnectionConfig, dumpOptions: DumpOptions) {
      dumps.push(connection);
      await dumpOptions.stdout(streamOf(options.dumpBody ?? 'SELECT 1;\n'));
    },
  };

  const create = createCreate({
    ask: unused as never,
    confirm: async (message: string) => {
      confirmations.push(message);
      return options.confirmAnswer ?? true;
    },
    cwd: () => options.root,
    getDriver: () => driver,
    runner,
    now: () => NOW,
  });

  return { create, preflights, confirmations, dumps };
}

describe('commands/create', () => {
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

  function writeExisting(name: string, content: string): string {
    fs.mkdirSync(storage, { recursive: true });
    const file = path.join(storage, `${name}.sql`);
    fs.writeFileSync(file, content);
    return file;
  }

  /** Runs create with positional arguments, as the CLI parser would supply them. */
  function invoke(
    create: ReturnType<typeof createHarness>['create'],
    ...args: unknown[]
  ) {
    return create({
      args: new Map<string | number, unknown>(
        args.map((value, index) => [index, value]),
      ),
    } as never);
  }

  test('writes a named Snapshot with its header to the Snapshot Storage', async () => {
    const { create } = createHarness({
      root,
      dumpBody: 'CREATE TABLE t;\n',
    });

    const result = await invoke(create, 'baseline');

    const file = path.join(storage, 'baseline.sql');
    const [headerLine] = fs.readFileSync(file, 'utf8').split('\n');

    expect(result).toMatchObject({
      kind: 'create',
      overwritten: false,
      snapshot: {
        name: 'baseline',
        file,
        driver: 'mysql',
        connection: 'local',
      },
    });
    expect(parseSnapshotHeader(headerLine ?? '')).toMatchObject({
      driver: 'mysql',
      connection: 'local',
    });
    expect(fs.readFileSync(file, 'utf8')).toContain('CREATE TABLE t;');
  });

  test('keeps a Named Snapshot exact when all characters are in [A-Za-z0-9._-]', async () => {
    const { create } = createHarness({ root });

    const result = await invoke(create, 'Release_1.2.0--rc-1');

    expect(result).toMatchObject({
      snapshot: { name: 'Release_1.2.0--rc-1' },
    });
    expect(fs.existsSync(path.join(storage, 'Release_1.2.0--rc-1.sql'))).toBe(
      true,
    );
  });

  test('sanitizes characters outside [A-Za-z0-9._-] to - without collapsing or trimming', async () => {
    const { create } = createHarness({ root });

    const slashResult = await invoke(create, 'Release 1.2/final');
    const spacedResult = await invoke(create, '  Release 1.2 / final@prod:1  ');

    expect(slashResult).toMatchObject({
      snapshot: { name: 'Release-1.2-final' },
    });
    expect(fs.existsSync(path.join(storage, 'Release-1.2-final.sql'))).toBe(
      true,
    );
    expect(spacedResult).toMatchObject({
      snapshot: { name: '--Release-1.2---final-prod-1--' },
    });
    expect(
      fs.existsSync(path.join(storage, '--Release-1.2---final-prod-1--.sql')),
    ).toBe(true);
  });

  test('names an Automatic Snapshot after the Connection and creation time', async () => {
    const { create } = createHarness({ root });

    const result = await invoke(create);

    expect(result).toMatchObject({
      snapshot: { name: 'local_2026-10-31_21-30-00' },
    });
    expect(
      fs.existsSync(path.join(storage, 'local_2026-10-31_21-30-00.sql')),
    ).toBe(true);
  });

  test('refuses an empty Snapshot Name as a usage error', async () => {
    const { create, dumps } = createHarness({ root });

    const error = await invoke(create, '').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toBe('usage');
    expect(dumps).toHaveLength(0);
  });

  test.each(['.hidden', '..', '../escape'])(
    'rejects Snapshot Name %p with a leading dot',
    async (badName) => {
      const { create, dumps } = createHarness({ root });

      const error = await invoke(create, badName).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(UserError);
      expect((error as UserError).code).toBe('usage');
      expect(dumps).toHaveLength(0);
      expect(fs.existsSync(storage)).toBe(false);
    },
  );

  test('keeps an existing Snapshot when the user declines to overwrite it', async () => {
    const file = writeExisting('baseline', 'OLD DUMP\n');
    const { create, confirmations, dumps } = createHarness({
      root,
      confirmAnswer: false,
    });

    const result = await invoke(create, 'baseline');

    expect(result).toBeUndefined();
    expect(confirmations).toEqual([
      "You're sure you want to overwrite this file?",
    ]);
    expect(dumps).toHaveLength(0);
    expect(fs.readFileSync(file, 'utf8')).toBe('OLD DUMP\n');
  });

  test('replaces an existing Snapshot and reports it as overwritten when the user confirms', async () => {
    const file = writeExisting('baseline', 'OLD DUMP\n');
    const { create, confirmations } = createHarness({
      root,
      dumpBody: 'NEW DUMP\n',
      confirmAnswer: true,
    });

    const result = await invoke(create, 'baseline');

    expect(confirmations).toHaveLength(1);
    expect(result).toMatchObject({ kind: 'create', overwritten: true });
    expect(fs.readFileSync(file, 'utf8')).toContain('NEW DUMP');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('OLD DUMP');
  });

  test('fails on a missing dump binary before any prompt or write', async () => {
    const file = writeExisting('baseline', 'OLD DUMP\n');
    const missing = new UserError('mysqldump not found', 'missing_binary');
    const { create, preflights, confirmations, dumps } = createHarness({
      root,
      preflightError: missing,
    });

    const error = await invoke(create, 'baseline').catch(
      (caught: unknown) => caught,
    );

    expect(error).toBe(missing);
    expect(preflights).toEqual(['mysqldump']);
    expect(confirmations).toHaveLength(0);
    expect(dumps).toHaveLength(0);
    expect(fs.readFileSync(file, 'utf8')).toBe('OLD DUMP\n');
  });

  test('fails on a missing project config before the dump binary is checked', async () => {
    fs.rmSync(path.join(root, CONFIG_FILE_NAME));
    const { create, preflights, dumps } = createHarness({ root });

    const error = await invoke(create, 'baseline').catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(UserError);
    expect(preflights).toHaveLength(0);
    expect(dumps).toHaveLength(0);
    expect(fs.existsSync(storage)).toBe(false);
  });
});
