import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const ENTRYPOINT = join(import.meta.dir, '..', 'index.ts');

function runCli(...args: string[]): { exitCode: number; output: string } {
  return spawn([], args);
}

function spawn(
  bunArgs: string[],
  args: string[],
  env: Record<string, string> = {},
): { exitCode: number; output: string } {
  const result = Bun.spawnSync(['bun', ...bunArgs, ENTRYPOINT, ...args], {
    stdin: 'ignore',
    env: { ...process.env, ...env },
  });

  return {
    exitCode: result.exitCode ?? -1,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

describe('cli exit codes', () => {
  test('a missing command is a usage error (2)', () => {
    expect(runCli().exitCode).toBe(2);
  });

  test('an unknown command is a usage error (2)', () => {
    const { exitCode, output } = runCli('nope');

    expect(exitCode).toBe(2);
    expect(output).toContain('nope');
  });

  test('an unknown flag is a usage error (2)', () => {
    expect(runCli('load', '--bogus').exitCode).toBe(2);
  });

  test('a user error is exit 1 with a human message', () => {
    const { exitCode, output } = runCli('load', 'no-such-snapshot-xyz');

    expect(exitCode).toBe(1);
    expect(output).toContain('Config file not found');
  });

  test('an unexpected error prints its stack and exits non-zero', () => {
    const preload = join(import.meta.dir, 'fixtures-stub-command.ts');
    const { exitCode, output } = spawn(['--preload', preload], ['load'], {
      FIXTURE_COMMAND: 'throw',
    });

    expect(exitCode).not.toBe(0);
    expect(exitCode).not.toBe(2);
    expect(output).toContain('boom from test');
    expect(output).toContain('at ');
  });

  test('init without a terminal fails because input is required, writing nothing', () => {
    const cwd = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'dbs-')));

    try {
      const result = Bun.spawnSync(['bun', ENTRYPOINT, 'init'], {
        cwd,
        stdin: 'ignore',
      });
      const output = `${result.stdout.toString()}${result.stderr.toString()}`;

      expect(result.exitCode).toBe(1);
      expect(output).toContain('Input required');
      expect(fs.readdirSync(cwd)).toEqual([]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('a successful command exits 0', () => {
    const preload = join(import.meta.dir, 'fixtures-stub-command.ts');

    expect(spawn(['--preload', preload], ['load']).exitCode).toBe(0);
  });
});
