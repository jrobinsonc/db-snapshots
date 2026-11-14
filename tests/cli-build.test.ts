import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { join } from 'node:path';
import pkg from '../package.json';
import { listCommands } from '../src/commands';

const ROOT_DIR = join(import.meta.dir, '..');
const DIST_DIR = join(ROOT_DIR, 'dist');
const BINARY_PATH = join(DIST_DIR, 'dbs');

function runBinary(...args: string[]): { exitCode: number; output: string } {
  const result = Bun.spawnSync([BINARY_PATH, ...args], {
    stdin: 'ignore',
    // Run with an empty PATH to verify the compiled binary is self-contained
    // and does not shell out to a host `bun` executable.
    env: { ...process.env, PATH: '' },
  });

  return {
    exitCode: result.exitCode ?? -1,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

describe('compiled dbs binary (bun run build)', () => {
  let distExistedBefore = false;

  beforeAll(() => {
    distExistedBefore = fs.existsSync(DIST_DIR);

    const build = Bun.spawnSync(['bun', 'run', 'build'], {
      cwd: ROOT_DIR,
      stdin: 'ignore',
    });

    if (build.exitCode !== 0) {
      throw new Error(
        `bun run build failed (${build.exitCode}): ${build.stderr.toString()}`,
      );
    }
  });

  afterAll(() => {
    if (!distExistedBefore) {
      fs.rmSync(DIST_DIR, { recursive: true, force: true });
    }
  });

  test('compiles the CLI to dist/dbs with bun build --compile', () => {
    expect(pkg.scripts.build).toContain('bun build --compile');
    expect(pkg.scripts.build).toContain('dist/dbs');
    expect(fs.existsSync(BINARY_PATH)).toBe(true);
  });

  test('runs --version without Bun on PATH', () => {
    const { exitCode, output } = runBinary('--version');

    expect(exitCode).toBe(0);
    expect(output.trim()).toBe(pkg.version);
  });

  test('runs --help and lists every registered command', () => {
    const { exitCode, output } = runBinary('--help');

    expect(exitCode).toBe(0);

    for (const commandName of Object.keys(listCommands())) {
      expect(output).toContain(commandName);
    }
  });

  test.each(Object.keys(listCommands()))(
    'resolves registered command "%s"',
    (commandName) => {
      const { exitCode, output } = runBinary(commandName, '--help');

      expect(exitCode).toBe(0);
      expect(output).toContain(`dbs ${commandName}`);
    },
  );

  test('dist/ is ignored by git', () => {
    const result = Bun.spawnSync(['git', 'check-ignore', 'dist/dbs'], {
      cwd: ROOT_DIR,
      stdin: 'ignore',
    });

    expect(result.exitCode).toBe(0);
  });
});
