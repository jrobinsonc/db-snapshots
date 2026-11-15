import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  formatSnapshotHeader,
  parseSnapshotHeader,
  readSnapshotHeader,
  toIsoSeconds,
  writeSnapshotFile,
} from '../../src/utils/snapshot-header';

describe('utils/snapshot-header', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbs-')));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('toIsoSeconds and formatSnapshotHeader format UTC timestamps with second precision', () => {
    const dateWithMillis = new Date('2026-10-31T21:30:45.789Z');

    expect(toIsoSeconds(dateWithMillis)).toBe('2026-10-31T21:30:45Z');
    expect(
      formatSnapshotHeader({
        driver: 'mysql',
        connection: 'local',
        created: dateWithMillis,
      }),
    ).toBe(
      '-- db-snapshots: driver=mysql connection=local created=2026-10-31T21:30:45Z',
    );
  });

  test('parseSnapshotHeader parses valid headers, strips trailing CR from CRLF lines, and preserves unknown Drivers', () => {
    expect(
      parseSnapshotHeader(
        '-- db-snapshots: driver=pgsql connection=staging_primary created=2026-10-31T21:30:45Z',
      ),
    ).toEqual({
      driver: 'pgsql',
      connection: 'staging_primary',
      created: new Date('2026-10-31T21:30:45.000Z'),
    });

    expect(
      parseSnapshotHeader(
        '-- db-snapshots: driver=sqlite connection=local created=2026-10-31T21:30:45Z\r',
      ),
    ).toEqual({
      driver: 'sqlite',
      connection: 'local',
      created: new Date('2026-10-31T21:30:45.000Z'),
    });

    expect(
      parseSnapshotHeader(
        '-- db-snapshots: driver=oracle connection=legacy created=2026-10-31T21:30:45Z',
      ),
    ).toEqual({
      driver: 'oracle',
      connection: 'legacy',
      created: new Date('2026-10-31T21:30:45.000Z'),
    });
  });

  test('formatSnapshotHeader and parseSnapshotHeader round-trip metadata at second precision', () => {
    const formatted = formatSnapshotHeader({
      driver: 'mysql',
      connection: 'prod_read_replica',
      created: new Date('2026-10-31T21:30:45.999Z'),
    });

    expect(parseSnapshotHeader(formatted)).toEqual({
      driver: 'mysql',
      connection: 'prod_read_replica',
      created: new Date('2026-10-31T21:30:45.000Z'),
    });
  });

  test('parseSnapshotHeader returns undefined for non-header lines and malformed timestamps', () => {
    expect(parseSnapshotHeader('')).toBeUndefined();
    expect(parseSnapshotHeader('SELECT 1;')).toBeUndefined();
    expect(parseSnapshotHeader('-- MySQL dump 10.13')).toBeUndefined();
    expect(
      parseSnapshotHeader('-- db-snapshots: driver=mysql connection=local'),
    ).toBeUndefined();
    expect(
      parseSnapshotHeader(
        '-- db-snapshots: driver=mysql created=2026-10-31T21:30:45Z',
      ),
    ).toBeUndefined();
    expect(
      parseSnapshotHeader(
        '-- db-snapshots: driver=mysql connection=local created=not-a-timestamp',
      ),
    ).toBeUndefined();
    expect(
      parseSnapshotHeader(
        '-- db-snapshots: driver=mysql connection=local created=2026-13-45T99:99:99Z',
      ),
    ).toBeUndefined();
  });

  test('readSnapshotHeader returns undefined for empty files, headerless files, and files with malformed timestamps', async () => {
    const emptyFile = path.join(tempDir, 'empty.sql');
    fs.writeFileSync(emptyFile, '');
    expect(await readSnapshotHeader(emptyFile)).toBeUndefined();

    const singleLineNoNewline = path.join(tempDir, 'single-line.sql');
    fs.writeFileSync(singleLineNoNewline, 'SELECT 1;');
    expect(await readSnapshotHeader(singleLineNoNewline)).toBeUndefined();

    const foreignSql = path.join(tempDir, 'foreign.sql');
    fs.writeFileSync(
      foreignSql,
      '-- Foreign SQL dump\n-- db-snapshots: driver=mysql connection=local created=2026-10-31T21:30:45Z\nCREATE TABLE users (id INT);\n',
    );
    expect(await readSnapshotHeader(foreignSql)).toBeUndefined();

    const malformedTimestamp = path.join(tempDir, 'malformed.sql');
    fs.writeFileSync(
      malformedTimestamp,
      '-- db-snapshots: driver=mysql connection=local created=invalid-date\nSELECT 1;\n',
    );
    expect(await readSnapshotHeader(malformedTimestamp)).toBeUndefined();
  });

  test('writeSnapshotFile and readSnapshotHeader stream and parse LF, CRLF, and newline-free headers', async () => {
    const writtenFile = path.join(tempDir, 'written.sql');
    const created = new Date('2026-10-31T21:30:45.456Z');
    const dumpStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('CREATE TABLE t (id INT);\n'));
        controller.enqueue(Buffer.from('INSERT INTO t VALUES (1);\n'));
        controller.close();
      },
    });

    await writeSnapshotFile(
      writtenFile,
      { driver: 'mysql', connection: 'local', created },
      dumpStream,
    );

    expect(fs.readFileSync(writtenFile, 'utf8')).toBe(
      '-- db-snapshots: driver=mysql connection=local created=2026-10-31T21:30:45Z\nCREATE TABLE t (id INT);\nINSERT INTO t VALUES (1);\n',
    );
    expect(await readSnapshotHeader(writtenFile)).toEqual({
      driver: 'mysql',
      connection: 'local',
      created: new Date('2026-10-31T21:30:45.000Z'),
    });

    const crlfFile = path.join(tempDir, 'crlf.sql');
    fs.writeFileSync(
      crlfFile,
      '-- db-snapshots: driver=pgsql connection=main created=2026-10-31T21:30:45Z\r\nSELECT 1;\r\n',
    );
    expect(await readSnapshotHeader(crlfFile)).toEqual({
      driver: 'pgsql',
      connection: 'main',
      created: new Date('2026-10-31T21:30:45.000Z'),
    });

    const headerOnlyFile = path.join(tempDir, 'header-only.sql');
    fs.writeFileSync(
      headerOnlyFile,
      '-- db-snapshots: driver=sqlite connection=local created=2026-10-31T21:30:45Z',
    );
    expect(await readSnapshotHeader(headerOnlyFile)).toEqual({
      driver: 'sqlite',
      connection: 'local',
      created: new Date('2026-10-31T21:30:45.000Z'),
    });
  });

  test('readSnapshotHeader enforces the 4096-byte MAX_HEADER_BYTES bound on the first line', async () => {
    const prefix = '-- db-snapshots: driver=mysql connection=';
    const suffix = ' created=2026-10-31T21:30:45Z';
    const maxConnectionLength = 4096 - prefix.length - suffix.length;

    const exactBoundConnection = 'c'.repeat(maxConnectionLength);
    const exactBoundLine = `${prefix}${exactBoundConnection}${suffix}`;
    expect(Buffer.byteLength(exactBoundLine, 'utf8')).toBe(4096);

    const exactBoundFile = path.join(tempDir, 'exact-4096.sql');
    fs.writeFileSync(exactBoundFile, `${exactBoundLine}\nSELECT 1;\n`);
    expect(await readSnapshotHeader(exactBoundFile)).toEqual({
      driver: 'mysql',
      connection: exactBoundConnection,
      created: new Date('2026-10-31T21:30:45.000Z'),
    });

    const overBoundConnection = 'c'.repeat(maxConnectionLength + 1);
    const overBoundLine = `${prefix}${overBoundConnection}${suffix}`;
    expect(Buffer.byteLength(overBoundLine, 'utf8')).toBe(4097);

    const overBoundFile = path.join(tempDir, 'over-4096.sql');
    fs.writeFileSync(overBoundFile, `${overBoundLine}\nSELECT 1;\n`);
    expect(await readSnapshotHeader(overBoundFile)).toBeUndefined();
  });

  test('readSnapshotHeader stops reading at the first newline and cancels the stream without reading trailing chunks', async () => {
    const chunks = [
      Buffer.from('-- db-snapshots: driver=mysql '),
      Buffer.from(
        'connection=local created=2026-10-31T21:30:45Z\nINSERT INTO large_table VALUES (1);',
      ),
    ];
    let pulls = 0;
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const nextChunk = chunks[pulls];
        pulls += 1;

        if (!nextChunk) {
          throw new Error(
            'readSnapshotHeader read past the first newline into the rest of the Snapshot',
          );
        }

        controller.enqueue(nextChunk);
      },
      cancel() {
        cancelled = true;
      },
    });

    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      stream: () => stream,
    } as unknown as ReturnType<typeof Bun.file>);

    try {
      const header = await readSnapshotHeader(path.join(tempDir, 'large.sql'));

      expect(header).toEqual({
        driver: 'mysql',
        connection: 'local',
        created: new Date('2026-10-31T21:30:45.000Z'),
      });
      expect(pulls).toBe(2);
      expect(cancelled).toBe(true);
    } finally {
      fileSpy.mockRestore();
    }
  });

  test('readSnapshotHeader stops streaming once MAX_HEADER_BYTES is exceeded without reading remaining chunks', async () => {
    const chunkWithoutNewline = Buffer.alloc(2049, 'x');
    let pulls = 0;
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;

        if (pulls > 2) {
          throw new Error(
            'readSnapshotHeader continued reading after exceeding MAX_HEADER_BYTES',
          );
        }

        controller.enqueue(chunkWithoutNewline);
      },
      cancel() {
        cancelled = true;
      },
    });

    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      stream: () => stream,
    } as unknown as ReturnType<typeof Bun.file>);

    try {
      const header = await readSnapshotHeader(
        path.join(tempDir, 'long-first-line.sql'),
      );

      expect(header).toBeUndefined();
      expect(pulls).toBe(2);
      expect(cancelled).toBe(true);
    } finally {
      fileSpy.mockRestore();
    }
  });
});
