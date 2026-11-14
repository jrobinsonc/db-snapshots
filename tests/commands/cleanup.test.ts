import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCleanup } from '../../src/commands/cleanup';
import type { CleanupResult } from '../../src/types';
import { CONFIG_FILE_NAME } from '../../src/utils/find-config-file';
import { formatSnapshotHeader } from '../../src/utils/snapshot-header';

const ENTRYPOINT = path.join(import.meta.dir, '..', '..', 'index.ts');

describe('commands/cleanup', () => {
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
          read_replica: { driver: 'mysql', database: 'app' },
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

  async function runCleanup(): Promise<CleanupResult> {
    const cleanup = createCleanup({ cwd: () => root });
    const result = await cleanup({ args: new Map() });

    expect(result?.kind).toBe('cleanup');
    return result as CleanupResult;
  }

  test('keeps the newest 2 Automatic Snapshots by creation time even when filename order differs', async () => {
    // Filename looks newest lexicographically, but header created time is oldest.
    writeSnapshot('local_2026-10-31_23-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T08:00:00Z',
    });
    writeSnapshot('local_2026-10-31_10-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });
    writeSnapshot('local_2026-10-31_12-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T12:00:00Z',
    });
    writeSnapshot('local_2026-10-31_09-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T09:00:00Z',
    });

    const result = await runCleanup();

    expect(result.dry_run).toBe(false);
    expect(result.kept.map((snapshot) => snapshot.name)).toEqual([
      'local_2026-10-31_12-00-00',
      'local_2026-10-31_10-00-00',
    ]);
    expect(result.deleted.map((snapshot) => snapshot.name)).toEqual([
      'local_2026-10-31_09-00-00',
      'local_2026-10-31_23-00-00',
    ]);
    expect(fs.readdirSync(storage).sort()).toEqual([
      'local_2026-10-31_10-00-00.sql',
      'local_2026-10-31_12-00-00.sql',
    ]);
  });

  test('retains the newest 2 independently for each Connection', async () => {
    writeSnapshot('local_2026-10-31_10-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });
    writeSnapshot('local_2026-10-31_11-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T11:00:00Z',
    });
    writeSnapshot('local_2026-10-31_12-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T12:00:00Z',
    });

    writeSnapshot('staging_2026-10-31_13-00-00', {
      driver: 'mysql',
      connection: 'staging',
      created: '2026-10-31T13:00:00Z',
    });
    writeSnapshot('staging_2026-10-31_14-00-00', {
      driver: 'mysql',
      connection: 'staging',
      created: '2026-10-31T14:00:00Z',
    });
    writeSnapshot('staging_2026-10-31_15-00-00', {
      driver: 'mysql',
      connection: 'staging',
      created: '2026-10-31T15:00:00Z',
    });

    const result = await runCleanup();

    expect(result.deleted.map((snapshot) => snapshot.name).sort()).toEqual([
      'local_2026-10-31_10-00-00',
      'staging_2026-10-31_13-00-00',
    ]);
    expect(result.kept.map((snapshot) => snapshot.name).sort()).toEqual([
      'local_2026-10-31_11-00-00',
      'local_2026-10-31_12-00-00',
      'staging_2026-10-31_14-00-00',
      'staging_2026-10-31_15-00-00',
    ]);
    expect(fs.readdirSync(storage).sort()).toEqual([
      'local_2026-10-31_11-00-00.sql',
      'local_2026-10-31_12-00-00.sql',
      'staging_2026-10-31_14-00-00.sql',
      'staging_2026-10-31_15-00-00.sql',
    ]);
  });

  test('never touches Named Snapshots even when older than Automatic Snapshots', async () => {
    writeSnapshot('pristine', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-01T00:00:00Z',
    });
    writeSnapshot('local_baseline', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-02T00:00:00Z',
    });
    writeSnapshot('local_2026-10-31_10-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });
    writeSnapshot('local_2026-10-31_11-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T11:00:00Z',
    });
    writeSnapshot('local_2026-10-31_12-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T12:00:00Z',
    });

    const result = await runCleanup();

    expect(result.deleted.map((snapshot) => snapshot.name)).toEqual([
      'local_2026-10-31_10-00-00',
    ]);
    expect(fs.readdirSync(storage).sort()).toEqual([
      'local_2026-10-31_11-00-00.sql',
      'local_2026-10-31_12-00-00.sql',
      'local_baseline.sql',
      'pristine.sql',
    ]);
  });

  test('never touches Snapshots whose header Connection disagrees with the filename', async () => {
    writeSnapshot('local_2026-10-31_09-00-00', {
      driver: 'mysql',
      connection: 'other',
      created: '2026-10-31T09:00:00Z',
    });
    writeSnapshot('local_2026-10-31_10-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });
    writeSnapshot('local_2026-10-31_11-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T11:00:00Z',
    });
    writeSnapshot('local_2026-10-31_12-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T12:00:00Z',
    });

    const result = await runCleanup();

    expect(result.deleted.map((snapshot) => snapshot.name)).toEqual([
      'local_2026-10-31_10-00-00',
    ]);
    expect(fs.readdirSync(storage).sort()).toEqual([
      'local_2026-10-31_09-00-00.sql',
      'local_2026-10-31_11-00-00.sql',
      'local_2026-10-31_12-00-00.sql',
    ]);
  });

  test('never touches headerless files even when named like an Automatic Snapshot', async () => {
    writeSnapshot('local_2026-10-31_09-00-00');
    writeSnapshot('local_2026-10-31_10-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });
    writeSnapshot('local_2026-10-31_11-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T11:00:00Z',
    });
    writeSnapshot('local_2026-10-31_12-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T12:00:00Z',
    });

    const result = await runCleanup();

    expect(result.deleted.map((snapshot) => snapshot.name)).toEqual([
      'local_2026-10-31_10-00-00',
    ]);
    expect(fs.readdirSync(storage).sort()).toEqual([
      'local_2026-10-31_09-00-00.sql',
      'local_2026-10-31_11-00-00.sql',
      'local_2026-10-31_12-00-00.sql',
    ]);
  });

  test('handles Connection names containing underscores', async () => {
    writeSnapshot('read_replica_2026-10-31_10-00-00', {
      driver: 'mysql',
      connection: 'read_replica',
      created: '2026-10-31T10:00:00Z',
    });
    writeSnapshot('read_replica_2026-10-31_11-00-00', {
      driver: 'mysql',
      connection: 'read_replica',
      created: '2026-10-31T11:00:00Z',
    });
    writeSnapshot('read_replica_2026-10-31_12-00-00', {
      driver: 'mysql',
      connection: 'read_replica',
      created: '2026-10-31T12:00:00Z',
    });

    const result = await runCleanup();

    expect(result.deleted.map((snapshot) => snapshot.name)).toEqual([
      'read_replica_2026-10-31_10-00-00',
    ]);
    expect(result.kept.map((snapshot) => snapshot.name)).toEqual([
      'read_replica_2026-10-31_12-00-00',
      'read_replica_2026-10-31_11-00-00',
    ]);
  });

  test('deletes nothing when Snapshot Storage is missing, empty, or within the retention count', async () => {
    expect((await runCleanup()).deleted).toEqual([]);

    fs.mkdirSync(storage, { recursive: true });
    expect((await runCleanup()).deleted).toEqual([]);

    writeSnapshot('local_2026-10-31_10-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });
    writeSnapshot('local_2026-10-31_11-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T11:00:00Z',
    });

    const result = await runCleanup();

    expect(result.deleted).toEqual([]);
    expect(result.kept).toHaveLength(2);
    expect(fs.readdirSync(storage).sort()).toEqual([
      'local_2026-10-31_10-00-00.sql',
      'local_2026-10-31_11-00-00.sql',
    ]);
  });

  test('CLI prints each deleted name without prompting and exits 0', () => {
    writeSnapshot('pristine', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-01T00:00:00Z',
    });
    writeSnapshot('local_2026-10-31_09-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T09:00:00Z',
    });
    writeSnapshot('local_2026-10-31_10-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T10:00:00Z',
    });
    writeSnapshot('local_2026-10-31_11-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T11:00:00Z',
    });
    writeSnapshot('local_2026-10-31_12-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T12:00:00Z',
    });

    const result = Bun.spawnSync(['bun', ENTRYPOINT, 'cleanup'], {
      cwd: root,
      stdin: 'ignore',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe('');
    expect(result.stdout.toString().trim().split('\n')).toEqual([
      'local_2026-10-31_10-00-00',
      'local_2026-10-31_09-00-00',
    ]);
    expect(fs.readdirSync(storage).sort()).toEqual([
      'local_2026-10-31_11-00-00.sql',
      'local_2026-10-31_12-00-00.sql',
      'pristine.sql',
    ]);
  });

  test('CLI prints nothing and exits 0 when there is nothing to delete', () => {
    writeSnapshot('local_2026-10-31_11-00-00', {
      driver: 'mysql',
      connection: 'local',
      created: '2026-10-31T11:00:00Z',
    });

    const result = Bun.spawnSync(['bun', ENTRYPOINT, 'cleanup'], {
      cwd: root,
      stdin: 'ignore',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toBe('');
  });
});
