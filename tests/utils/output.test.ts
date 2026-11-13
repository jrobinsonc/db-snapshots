import { describe, expect, test } from 'bun:test';
import {
  colorize,
  disableColor,
  enableColor,
  isColorEnabled,
  renderError,
  renderResult,
} from '../../src/utils/output';
import type { Snapshot } from '../../src/types';

const snapshot: Snapshot = {
  name: 'baseline',
  file: '/tmp/baseline.sql',
  connection: null,
  driver: null,
  created_at: '2026-01-01T00:00:00.000Z',
  size_bytes: 12,
  compressed: false,
};

describe('isColorEnabled', () => {
  test('is on only for a TTY without NO_COLOR', () => {
    expect(isColorEnabled({ isTTY: true }, {})).toBe(true);
    expect(isColorEnabled({ isTTY: false }, {})).toBe(false);
    expect(isColorEnabled({}, {})).toBe(false);
    expect(isColorEnabled({ isTTY: true }, { NO_COLOR: '1' })).toBe(false);
  });
});

describe('colorize', () => {
  test('returns plain text when color is off', () => {
    expect(colorize('hi', 'red', false)).toBe('hi');
  });

  test('wraps text in ANSI escapes when color is on', () => {
    const text = colorize('hi', 'red', true);

    expect(text).toContain('\u001B[');
    expect(Bun.stripANSI(text)).toBe('hi');
  });
});

describe('renderResult', () => {
  test('describes a created snapshot', () => {
    expect(
      renderResult({ kind: 'create', snapshot, overwritten: false }, false),
    ).toBe('Dump file created: baseline');
  });

  test('describes an overwritten snapshot', () => {
    expect(
      renderResult({ kind: 'create', snapshot, overwritten: true }, false),
    ).toBe('Dump file updated: baseline');
  });

  test('describes a loaded snapshot', () => {
    expect(
      renderResult(
        {
          kind: 'load',
          snapshot,
          connection: 'default',
          dropped: false,
          duration_ms: 5,
        },
        false,
      ),
    ).toBe('Dump file imported: baseline');
  });

  test('reports a written config', () => {
    expect(
      renderResult(
        {
          kind: 'init',
          config_file: '/app/.db-snapshots.json',
          connection: 'local',
          password_env_var: null,
        },
        false,
      ),
    ).toBe('Config written: /app/.db-snapshots.json');
  });

  test('a written config with a moved password advises putting it in .env', () => {
    const text = renderResult(
      {
        kind: 'init',
        config_file: '/app/.db-snapshots.json',
        connection: 'local',
        password_env_var: 'DB_PASSWORD',
      },
      false,
    );

    expect(text).toStartWith('Config written: /app/.db-snapshots.json\n');
    expect(text).toContain('The password was not written to the config.');
    expect(text).toContain('password environment variable');
    expect(text).toContain('.env');
  });

  test('lists each deleted snapshot name for cleanup', () => {
    expect(
      renderResult(
        {
          kind: 'cleanup',
          deleted: [
            { ...snapshot, name: 'local_2026-10-31_10-00-00' },
            { ...snapshot, name: 'local_2026-10-31_09-00-00' },
          ],
          kept: [],
          dry_run: false,
        },
        false,
      ),
    ).toBe('local_2026-10-31_10-00-00\nlocal_2026-10-31_09-00-00');
  });

  test('returns an empty string for cleanup when nothing was deleted', () => {
    expect(
      renderResult(
        {
          kind: 'cleanup',
          deleted: [],
          kept: [snapshot],
          dry_run: false,
        },
        false,
      ),
    ).toBe('');
  });
});

describe('renderError', () => {
  test('prefixes the message', () => {
    expect(renderError('bad', false)).toBe('Error: bad');
  });
});

describe('disableColor', () => {
  test('turns color off even for a TTY', () => {
    expect(isColorEnabled({ isTTY: true }, {})).toBe(true);

    disableColor();

    try {
      expect(isColorEnabled({ isTTY: true }, {})).toBe(false);
      expect(isColorEnabled({ isTTY: true }, { FORCE_COLOR: '1' })).toBe(false);
    } finally {
      enableColor();
    }
  });
});
