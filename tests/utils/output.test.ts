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
