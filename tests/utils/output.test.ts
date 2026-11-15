import { describe, expect, spyOn, test } from 'bun:test';
import { localTimeParts } from '../../src/utils/local-time';
import {
  colorize,
  disableColor,
  enableColor,
  formatSize,
  isColorEnabled,
  printDiagnostic,
  printError,
  printResult,
  progress,
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
  test('enables color for a TTY or non-empty FORCE_COLOR unless NO_COLOR is set', () => {
    expect(isColorEnabled({ isTTY: true }, {})).toBe(true);
    expect(isColorEnabled({ isTTY: false }, {})).toBe(false);
    expect(isColorEnabled({}, {})).toBe(false);
    expect(isColorEnabled({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);
    expect(isColorEnabled({}, { FORCE_COLOR: '1' })).toBe(true);
    expect(isColorEnabled({ isTTY: false }, { FORCE_COLOR: '' })).toBe(false);
    expect(isColorEnabled({ isTTY: true }, { NO_COLOR: '1' })).toBe(false);
    expect(
      isColorEnabled({ isTTY: false }, { FORCE_COLOR: '1', NO_COLOR: '1' }),
    ).toBe(false);
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

describe('formatSize', () => {
  test('formats byte counts across base-1024 units and rounding boundaries', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1024)).toBe('1.0 KiB');
    expect(formatSize(1536)).toBe('1.5 KiB');
    // 1048575 rounds to 1024.0 KiB, so it promotes to 1.0 MiB instead.
    expect(formatSize(1048575)).toBe('1.0 MiB');
    expect(formatSize(1024 ** 3)).toBe('1.0 GiB');
    expect(formatSize(1024 ** 4)).toBe('1.0 TiB');
    expect(formatSize(1024 ** 5)).toBe('1024.0 TiB');
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

  test('describes a deleted snapshot', () => {
    expect(renderResult({ kind: 'delete', deleted: snapshot }, false)).toBe(
      'Snapshot deleted: baseline',
    );
  });

  test('renders an empty list message when there are no snapshots', () => {
    expect(renderResult({ kind: 'list', snapshots: [] }, false)).toBe(
      'No snapshots found',
    );
  });

  test('renders snapshots as an aligned table with fallbacks for headerless files', () => {
    const first: Snapshot = {
      name: 'local_2026-10-31_21-30-00',
      file: '/tmp/local_2026-10-31_21-30-00.sql.gz',
      connection: 'local',
      driver: 'mysql',
      created_at: '2026-10-31T21:30:00.000Z',
      size_bytes: 1536,
      compressed: true,
    };
    const second: Snapshot = {
      ...snapshot,
      name: 'manual',
    };

    const formatExpectedTime = (iso: string): string => {
      const { date, time } = localTimeParts(new Date(iso));
      return `${date} ${time.join(':')}`;
    };

    const table = renderResult(
      { kind: 'list', snapshots: [first, second] },
      false,
    );

    expect(table).toBe(
      [
        'Name                       Connection  Driver  Created at           Size     Compressed',
        `local_2026-10-31_21-30-00  local       mysql   ${formatExpectedTime(first.created_at)}  1.5 KiB  yes`,
        `manual                     —           —       ${formatExpectedTime(second.created_at)}  12 B     no`,
      ].join('\n'),
    );
  });
});

describe('renderError', () => {
  test('prefixes the message', () => {
    expect(renderError('bad', false)).toBe('Error: bad');
  });
});

describe('disableColor', () => {
  test('turns color off even for a TTY or when FORCE_COLOR is set', () => {
    expect(isColorEnabled({ isTTY: true }, {})).toBe(true);
    expect(isColorEnabled({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);

    disableColor();

    try {
      expect(isColorEnabled({ isTTY: true }, {})).toBe(false);
      expect(isColorEnabled({ isTTY: true }, { FORCE_COLOR: '1' })).toBe(false);
      expect(isColorEnabled({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(
        false,
      );
    } finally {
      enableColor();
    }
  });
});

describe('printResult', () => {
  test('prints non-empty rendered results to stdout', () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    disableColor();

    try {
      printResult({ kind: 'delete', deleted: snapshot });
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('Snapshot deleted: baseline');
    } finally {
      enableColor();
      logSpy.mockRestore();
    }
  });

  test('writes nothing when the rendered result is empty', () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    try {
      printResult({
        kind: 'cleanup',
        deleted: [],
        kept: [snapshot],
        dry_run: false,
      });
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('printError', () => {
  test('writes the formatted error line to stderr', () => {
    const writeSpy = spyOn(process.stderr, 'write').mockImplementation(
      () => true,
    );
    disableColor();

    try {
      printError('something broke');
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(writeSpy).toHaveBeenCalledWith('Error: something broke\n');
    } finally {
      enableColor();
      writeSpy.mockRestore();
    }
  });
});

describe('printDiagnostic', () => {
  test('writes raw diagnostic text to stderr', () => {
    const writeSpy = spyOn(process.stderr, 'write').mockImplementation(
      () => true,
    );
    disableColor();

    try {
      printDiagnostic('stack line 1');
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(writeSpy).toHaveBeenCalledWith('stack line 1\n');
    } finally {
      enableColor();
      writeSpy.mockRestore();
    }
  });
});

describe('progress', () => {
  test('prints progress messages to stderr', () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

    try {
      progress('Working...');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('Working...');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
