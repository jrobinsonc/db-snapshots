import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCreate } from '../../src/commands/create';
import { createMysqlDriver } from '../../src/drivers/mysql';
import type { Driver, DumpOptions } from '../../src/drivers/types';
import { UserError } from '../../src/utils/exceptions';
import { CONFIG_FILE_NAME } from '../../src/utils/find-config-file';
import type { ConnectionConfig } from '../../src/utils/load-config';
import { createRunner } from '../../src/utils/process-runner';
import type { ProcessRunner } from '../../src/utils/process-runner';
import { parseSnapshotHeader } from '../../src/utils/snapshot-header';

const ENTRYPOINT = path.join(import.meta.dir, '..', '..', 'index.ts');
const EXIT_INTERRUPTED = 130;
const PARTIAL_WAIT_TIMEOUT_MS = 5000;
const PARTIAL_POLL_INTERVAL_MS = 10;

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
  driver?: Driver;
  runner?: ProcessRunner;
  onDump?: (
    connection: ConnectionConfig,
    dumpOptions: DumpOptions,
  ) => Promise<void>;
}

function createHarness(options: HarnessOptions) {
  const preflights: string[] = [];
  const confirmations: string[] = [];
  const dumps: ConnectionConfig[] = [];
  const exitCodes: number[] = [];

  const runner: ProcessRunner = options.runner ?? {
    preflight(binary) {
      preflights.push(binary);
      if (options.preflightError) {
        throw options.preflightError;
      }
    },
    run: unused as ProcessRunner['run'],
  };

  const driver: Driver = options.driver ?? {
    name: 'mysql',
    binaries: { dump: 'mysqldump', load: 'mysql' },
    defaultDumpFlags: async () => [],
    withCredentials: unused,
    listTables: unused,
    dropAllStatements: unused,
    load: unused,
    async dump(connection: ConnectionConfig, dumpOptions: DumpOptions) {
      dumps.push(connection);
      if (options.onDump) {
        await options.onDump(connection, dumpOptions);
        return;
      }
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
    exit: (code) => {
      exitCodes.push(code);
    },
  });

  return { create, preflights, confirmations, dumps, exitCodes };
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

  test('writes output to <file>.partial first and renames it to <file> on success', async () => {
    const file = path.join(storage, 'baseline.sql');
    const partialFile = `${file}.partial`;
    let sawPartialDuringDump = false;
    let sawFinalDuringDump = false;
    let partialContentDuringDump = '';

    const { create } = createHarness({
      root,
      onDump: async (_connection, dumpOptions) => {
        await dumpOptions.stdout(streamOf('CREATE TABLE t (id INT);\n'));
        sawPartialDuringDump = fs.existsSync(partialFile);
        sawFinalDuringDump = fs.existsSync(file);
        partialContentDuringDump = fs.readFileSync(partialFile, 'utf8');
      },
    });

    const result = await invoke(create, 'baseline');

    expect(sawPartialDuringDump).toBe(true);
    expect(sawFinalDuringDump).toBe(false);
    expect(partialContentDuringDump).toContain('-- db-snapshots:');
    expect(partialContentDuringDump).toContain('CREATE TABLE t (id INT);');
    expect(result).toMatchObject({
      kind: 'create',
      snapshot: { name: 'baseline', file },
    });
    expect(fs.existsSync(partialFile)).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(partialContentDuringDump);
  });

  test('removes <file>.partial and reports the client stderr when the dump client fails', async () => {
    const file = path.join(storage, 'baseline.sql');
    const partialFile = `${file}.partial`;
    const clientStderr = "mysqldump: Got error: 1049: Unknown database 'app'";
    const runner = createRunner({
      which: () => '/usr/bin/mysqldump',
      spawn: (command) => {
        if (command.includes('--version')) {
          return {
            stdout: streamOf('mysqldump  Ver 8.0.36\n'),
            stderr: streamOf(''),
            exited: Promise.resolve(0),
            kill: () => {},
          };
        }

        return {
          stdout: streamOf('CREATE TABLE partial (id INT);\n'),
          stderr: streamOf(`${clientStderr}\n`),
          exited: Promise.resolve(2),
          kill: () => {},
        };
      },
    });
    const driver = createMysqlDriver({ runner, tempDir: () => root });
    const { create } = createHarness({ root, driver, runner });

    const error = await invoke(create, 'baseline').catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toBe('client_failed');
    expect((error as UserError).message).toContain(clientStderr);
    expect(fs.existsSync(partialFile)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  test('removes <file>.partial and leaves an existing Snapshot intact when an overwrite fails', async () => {
    const file = writeExisting('baseline', 'OLD DUMP\n');
    const partialFile = `${file}.partial`;

    const { create } = createHarness({
      root,
      confirmAnswer: true,
      onDump: async (_connection, dumpOptions) => {
        await dumpOptions.stdout(streamOf('HALF WRITTEN\n'));
        expect(fs.existsSync(partialFile)).toBe(true);
        throw new UserError(
          'mysqldump failed: lost connection',
          'client_failed',
        );
      },
    });

    const error = await invoke(create, 'baseline').catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toBe('client_failed');
    expect((error as UserError).message).toContain('lost connection');
    expect(fs.existsSync(partialFile)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('OLD DUMP\n');
  });

  test('removes <file>.partial when writing the dump stream fails mid-stream', async () => {
    const file = path.join(storage, 'baseline.sql');
    const partialFile = `${file}.partial`;

    const { create } = createHarness({
      root,
      onDump: async (_connection, dumpOptions) => {
        const failingStream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('CREATE TABLE t (id INT);\n'),
            );
            controller.error(new Error('stream broken'));
          },
        });

        await dumpOptions.stdout(failingStream);
      },
    });

    const error = await invoke(create, 'baseline').catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('stream broken');
    expect(fs.existsSync(partialFile)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  test('removes <file>.partial and exits 130 when interrupted by SIGINT', async () => {
    const file = path.join(storage, 'baseline.sql');
    const partialFile = `${file}.partial`;

    const { create, exitCodes } = createHarness({
      root,
      onDump: async (_connection, dumpOptions) => {
        await dumpOptions.stdout(streamOf('CREATE TABLE t (id INT);\n'));
        expect(fs.existsSync(partialFile)).toBe(true);
        process.emit('SIGINT', 'SIGINT');
      },
    });

    const result = await invoke(create, 'baseline');

    expect(result).toBeUndefined();
    expect(exitCodes).toEqual([EXIT_INTERRUPTED]);
    expect(fs.existsSync(partialFile)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  test('CLI removes <file>.partial and exits 130 on Ctrl-C (SIGINT) during dump', async () => {
    const binDir = path.join(root, 'bin');
    const partialFile = path.join(storage, 'baseline.sql.partial');
    const finalFile = path.join(storage, 'baseline.sql');

    fs.mkdirSync(binDir);
    fs.writeFileSync(
      path.join(binDir, 'mysqldump'),
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then',
        '  echo "mysqldump  Ver 8.0.36"',
        '  exit 0',
        'fi',
        'printf "CREATE TABLE t (id INT);\\n"',
        'exec sleep 60',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    const proc = Bun.spawn(['bun', ENTRYPOINT, 'create', 'baseline'], {
      cwd: root,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
      },
    });

    const deadline = Date.now() + PARTIAL_WAIT_TIMEOUT_MS;

    while (
      (!fs.existsSync(partialFile) || fs.statSync(partialFile).size === 0) &&
      Date.now() < deadline
    ) {
      await Bun.sleep(PARTIAL_POLL_INTERVAL_MS);
    }

    expect(fs.existsSync(partialFile)).toBe(true);
    expect(fs.existsSync(finalFile)).toBe(false);

    proc.kill('SIGINT');

    const exitCode = await proc.exited;

    expect(exitCode).toBe(EXIT_INTERRUPTED);
    expect(fs.existsSync(partialFile)).toBe(false);
    expect(fs.existsSync(finalFile)).toBe(false);
  });

  test('CLI removes <file>.partial and reports client stderr on failure', async () => {
    const binDir = path.join(root, 'bin');
    const partialFile = path.join(storage, 'baseline.sql.partial');
    const finalFile = path.join(storage, 'baseline.sql');

    fs.mkdirSync(binDir);
    fs.writeFileSync(
      path.join(binDir, 'mysqldump'),
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then',
        '  echo "mysqldump  Ver 8.0.36"',
        '  exit 0',
        'fi',
        'printf "CREATE TABLE partial (id INT);\\n"',
        'printf "mysqldump: Got error: 1045: Access denied\\n" >&2',
        'exit 2',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    const result = Bun.spawnSync(['bun', ENTRYPOINT, 'create', 'baseline'], {
      cwd: root,
      stdin: 'ignore',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toContain(
      'mysqldump: Got error: 1045: Access denied',
    );
    expect(fs.existsSync(partialFile)).toBe(false);
    expect(fs.existsSync(finalFile)).toBe(false);
  });
});
