import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  formatSnapshotHeader,
  parseSnapshotHeader,
  readSnapshotHeader,
  toIsoSeconds,
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
      '-- Foreign SQL dump\nCREATE TABLE users (id INT);\n',
    );
    expect(await readSnapshotHeader(foreignSql)).toBeUndefined();

    const malformedTimestamp = path.join(tempDir, 'malformed.sql');
    fs.writeFileSync(
      malformedTimestamp,
      '-- db-snapshots: driver=mysql connection=local created=invalid-date\nSELECT 1;\n',
    );
    expect(await readSnapshotHeader(malformedTimestamp)).toBeUndefined();
  });
});
