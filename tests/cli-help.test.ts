import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import pkg from '../package.json';

const ENTRYPOINT = join(import.meta.dir, '..', 'index.ts');

function runCli(...args: string[]): { exitCode: number; output: string } {
  const result = Bun.spawnSync(['bun', ENTRYPOINT, ...args], {
    stdin: 'ignore',
  });

  return {
    exitCode: result.exitCode ?? -1,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

describe('cli help and version', () => {
  test.each(['--help', 'help'])('%s lists the commands', (arg) => {
    const { exitCode, output } = runCli(arg);

    expect(exitCode).toBe(0);
    expect(output).toContain('create');
    expect(output).toContain('load');
  });

  test('help <command> describes that command', () => {
    const { exitCode, output } = runCli('help', 'load');

    expect(exitCode).toBe(0);
    expect(output).toContain('dbs load');
    expect(output).not.toContain('dbs create');
  });

  test('<command> --help describes that command', () => {
    const { exitCode, output } = runCli('create', '--help');

    expect(exitCode).toBe(0);
    expect(output).toContain('dbs create');
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
