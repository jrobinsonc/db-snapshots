import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import pkg from '../package.json';
import { listCommands } from '../src/commands';
import { CONFIG_FILE_NAME } from '../src/utils/find-config-file';

const ENTRYPOINT = join(import.meta.dir, '..', 'index.ts');

interface CliOptions {
  cwd?: string;
  env?: Record<string, string>;
}

function runCliWithOptions(
  args: string[],
  options: CliOptions = {},
): { exitCode: number; output: string } {
  const env = { ...process.env };
  delete env['NO_COLOR'];
  delete env['FORCE_COLOR'];

  const result = Bun.spawnSync(['bun', ENTRYPOINT, ...args], {
    cwd: options.cwd,
    stdin: 'ignore',
    env: options.env ? { ...env, ...options.env } : env,
  });

  return {
    exitCode: result.exitCode ?? -1,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

function runCli(...args: string[]): { exitCode: number; output: string } {
  return runCliWithOptions(args);
}

function withTempDir<T>(run: (cwd: string) => T): T {
  const cwd = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'dbs-')));

  try {
    return run(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

describe('cli help and version', () => {
  test.each(['--help', 'help'])('%s lists every registered command', (arg) => {
    const { exitCode, output } = runCli(arg);
    const registeredCommands = Object.keys(listCommands());

    expect(exitCode).toBe(0);
    expect(registeredCommands.length).toBeGreaterThan(0);

    for (const commandName of registeredCommands) {
      expect(output).toContain(commandName);
    }
  });

  test('help <command> describes that command', () => {
    const { exitCode, output } = runCli('help', 'load');

    expect(exitCode).toBe(0);
    expect(output).toContain('dbs load');
    expect(output).not.toContain('dbs create');

    const deleteHelp = runCli('help', 'delete');

    expect(deleteHelp.exitCode).toBe(0);
    expect(deleteHelp.output).toContain('dbs delete');
    expect(deleteHelp.output).not.toContain('dbs create');
  });

  test('<command> --help describes that command', () => {
    const { exitCode, output } = runCli('create', '--help');

    expect(exitCode).toBe(0);
    expect(output).toContain('dbs create');

    const deleteHelp = runCli('delete', '--help');

    expect(deleteHelp.exitCode).toBe(0);
    expect(deleteHelp.output).toContain('dbs delete');
  });

  test('help for an unknown command is a usage error (2)', () => {
    const { exitCode, output } = runCli('help', 'nope');

    expect(exitCode).toBe(2);
    expect(output).toContain('nope');
  });

  test('--version prints the package.json version', () => {
    const { exitCode, output } = runCli('--version');

    expect(exitCode).toBe(0);
    expect(output.trim()).toBe(pkg.version);
  });
});

describe('cli --no-color', () => {
  test('is listed in help', () => {
    const { exitCode, output } = runCli('--help');

    expect(exitCode).toBe(0);
    expect(output).toContain('--no-color');
  });

  test('omits ANSI escapes on a succeeding command even when FORCE_COLOR is set', () => {
    withTempDir((cwd) => {
      const storage = join(cwd, 'snapshots');

      fs.writeFileSync(
        join(cwd, CONFIG_FILE_NAME),
        JSON.stringify({
          connections: {
            local: { driver: 'mysql', database: 'app' },
          },
        }),
      );
      fs.mkdirSync(storage);
      fs.writeFileSync(join(storage, 'baseline.sql'), 'SELECT 1;\n');
      fs.writeFileSync(join(storage, 'other.sql'), 'SELECT 1;\n');
      fs.writeFileSync(join(storage, 'third.sql'), 'SELECT 1;\n');

      const colored = runCliWithOptions(['delete', 'baseline'], {
        cwd,
        env: { FORCE_COLOR: '1' },
      });

      expect(colored.exitCode).toBe(0);
      expect(colored.output).toContain('\u001B[');
      expect(Bun.stripANSI(colored.output).trim()).toBe(
        'Snapshot deleted: baseline',
      );

      for (const args of [
        ['--no-color', 'delete', 'other'],
        ['delete', 'third', '--no-color'],
      ]) {
        const plain = runCliWithOptions(args, {
          cwd,
          env: { FORCE_COLOR: '1' },
        });

        expect(plain.exitCode).toBe(0);
        expect(plain.output).not.toContain('\u001B[');
        expect(Bun.stripANSI(plain.output)).toBe(plain.output);
        expect(plain.output.trim()).toBe(
          `Snapshot deleted: ${args.includes('other') ? 'other' : 'third'}`,
        );
      }
    });
  });

  test('omits ANSI escapes on a failing valid command even when FORCE_COLOR is set', () => {
    withTempDir((cwd) => {
      const colored = runCliWithOptions(['list'], {
        cwd,
        env: { FORCE_COLOR: '1' },
      });

      expect(colored.exitCode).toBe(1);
      expect(colored.output).toContain('\u001B[');
      expect(Bun.stripANSI(colored.output)).toContain(
        'Error: Config file not found',
      );

      const plain = runCliWithOptions(['--no-color', 'list'], {
        cwd,
        env: { FORCE_COLOR: '1' },
      });

      expect(plain.exitCode).toBe(1);
      expect(plain.output).toContain('Error: Config file not found');
      expect(plain.output).not.toContain('\u001B[');
      expect(Bun.stripANSI(plain.output)).toBe(plain.output);
    });
  });

  test('is accepted on an unknown command and omits ANSI escapes when FORCE_COLOR is set', () => {
    const { exitCode, output } = runCliWithOptions(['--no-color', 'nope'], {
      env: { FORCE_COLOR: '1' },
    });

    expect(exitCode).toBe(2);
    expect(output).toContain('nope');
    expect(output).not.toContain('\u001B[');
  });
});
