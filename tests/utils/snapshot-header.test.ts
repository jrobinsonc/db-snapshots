import { describe, expect, test } from 'bun:test';

import {
  formatSnapshotHeader,
  parseSnapshotHeader,
  toIsoSeconds,
} from '../../src/utils/snapshot-header';

describe('utils/snapshot-header', () => {
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
});
