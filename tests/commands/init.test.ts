import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Question } from 'inquirer';

import pkg from '../../package.json';
import { createInit } from '../../src/commands/init';
import { UserError } from '../../src/utils/exceptions';
import { CONFIG_FILE_NAME } from '../../src/utils/find-config-file';
import { loadConfig } from '../../src/utils/load-config';

const ANSWERS = {
  name: 'local',
  host: '127.0.0.1',
  port: '3306',
  user: 'root',
  password: '',
  database: 'app',
};

describe('commands/init', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbs-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function setup(answers: Record<string, unknown>) {
    const asked: string[] = [];
    const init = createInit({
      cwd: () => root,
      ask: async (questions) => {
        asked.push(...questions.map((question) => question.name));

        return Object.fromEntries(
          questions.map((question) => [question.name, answers[question.name]]),
        ) as never;
      },
    });

    return { init, asked };
  }

  const configPath = (): string => path.join(root, CONFIG_FILE_NAME);

  test('the prompts reject input that would make an unusable config', async () => {
    const questions: Question[] = [];
    const init = createInit({
      cwd: () => root,
      ask: async (asked) => {
        questions.push(...asked);

        return ANSWERS as never;
      },
    });

    await init({ args: new Map() });

    const validate = (name: string, input: string) =>
      questions.find((question) => question.name === name)?.validate?.(input);

    expect(validate('port', 'abc')).toBeString();
    expect(validate('port', '3306')).toBe(true);
    expect(validate('name', '')).toBeString();
    expect(validate('host', ' ')).toBeString();
    expect(validate('user', '')).toBeString();
    expect(validate('database', '')).toBeString();
    expect(validate('database', 'app')).toBe(true);
  });

  test('it writes a valid config with one MySQL Connection from the prompted fields', async () => {
    const { init, asked } = setup(ANSWERS);

    await init({ args: new Map() });

    expect(asked).toEqual([
      'name',
      'host',
      'port',
      'user',
      'password',
      'database',
    ]);
    expect(loadConfig(configPath()).connections).toEqual({
      local: {
        driver: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        database: 'app',
      },
    });
  });

  test('it trims surrounding whitespace from the answers', async () => {
    const { init } = setup({
      ...ANSWERS,
      name: ' local ',
      host: ' db ',
      port: ' 3307 ',
      user: ' app ',
      database: ' shop ',
    });

    await init({ args: new Map() });

    expect(loadConfig(configPath()).connections).toEqual({
      local: {
        driver: 'mysql',
        host: 'db',
        port: 3307,
        user: 'app',
        database: 'shop',
      },
    });
  });

  test('it writes a $schema reference pinned to this release', async () => {
    const { init } = setup(ANSWERS);

    await init({ args: new Map() });

    const written = JSON.parse(fs.readFileSync(configPath(), 'utf8'));

    expect(written.$schema).toEqual(
      `https://raw.githubusercontent.com/jrobinsonc/db-snapshots/v${pkg.version}/db-snapshots.schema.json`,
    );
  });

  test('a typed password is replaced by a ${VAR} reference and the user is advised to use .env', async () => {
    const { init } = setup({ ...ANSWERS, password: 's3cret!' });

    const result = await init({ args: new Map() });

    const raw = fs.readFileSync(configPath(), 'utf8');

    expect(raw).not.toContain('s3cret!');
    expect(loadConfig(configPath()).connections['local']?.password).toEqual(
      '${DB_PASSWORD}',
    );
    expect(result).toMatchObject({
      kind: 'init',
      password_env_var: 'DB_PASSWORD',
    });
  });

  test('a typed ${VAR} reference is kept as given', async () => {
    const { init } = setup({ ...ANSWERS, password: '${MYSQL_PWD}' });

    const result = await init({ args: new Map() });

    expect(loadConfig(configPath()).connections['local']?.password).toEqual(
      '${MYSQL_PWD}',
    );
    expect(result).toMatchObject({ kind: 'init', password_env_var: null });
  });

  test('it refuses, before prompting, when a config already exists', async () => {
    const existing = '{ "connections": { "keep": { "driver": "mysql" } } }';
    fs.writeFileSync(configPath(), existing);
    const { init, asked } = setup(ANSWERS);

    const error = await init({ args: new Map() }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toEqual('config_exists');
    expect((error as UserError).message).toContain(configPath());
    expect(asked).toEqual([]);
    expect(fs.readFileSync(configPath(), 'utf8')).toEqual(existing);
  });

  test('an empty password writes no password field', async () => {
    const { init } = setup(ANSWERS);

    const result = await init({ args: new Map() });

    expect(loadConfig(configPath()).connections['local']).not.toHaveProperty(
      'password',
    );
    expect(result).toMatchObject({
      kind: 'init',
      config_file: configPath(),
      connection: 'local',
      password_env_var: null,
    });
  });
});
