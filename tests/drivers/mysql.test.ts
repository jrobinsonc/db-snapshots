import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMysqlDriver } from '../../src/drivers/mysql';
import { UserError } from '../../src/utils/exceptions';
import type { ConnectionConfig } from '../../src/utils/load-config';
import type { ProcessRunner, RunOptions } from '../../src/utils/process-runner';

const EXPECTED_QUERY =
  'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME';
const PERMISSION_MASK = 0o777;
const OPTIONS_FILE_MODE = 0o600;
const MYSQL_PORT = 3306;

interface RecordedCall {
  command: string[];
  options: RunOptions;
  optionsFileContent?: string;
  optionsFileMode?: number;
}

describe('drivers/mysql', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbs-')));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function setupRunner(responseText: string, failWith?: Error) {
    const calls: RecordedCall[] = [];
    const runner: ProcessRunner = {
      preflight: () => {},
      run: async (command, options = {}) => {
        const extraFileArg = command.find((arg) =>
          arg.startsWith('--defaults-extra-file='),
        );
        const call: RecordedCall = { command, options };

        if (extraFileArg !== undefined) {
          const filePath = extraFileArg.slice('--defaults-extra-file='.length);
          call.optionsFileMode = fs.statSync(filePath).mode & PERMISSION_MASK;
          call.optionsFileContent = fs.readFileSync(filePath, 'utf8');
        }

        calls.push(call);

        if (failWith) {
          throw failWith;
        }

        if (options.stdout) {
          await options.stdout(new Blob([responseText]).stream());
        }

        return { stderr: '' };
      },
    };

    const driver = createMysqlDriver({ runner, tempDir: () => tempRoot });

    return { driver, calls };
  }

  describe('dropAllStatements', () => {
    test('queries information_schema.TABLES for the Connection database and passes credentials via --defaults-extra-file', async () => {
      const { driver, calls } = setupRunner('users\tBASE TABLE\n');
      const connection: ConnectionConfig = {
        driver: 'mysql',
        host: '127.0.0.1',
        port: MYSQL_PORT,
        user: 'app_user',
        password: 's3"cret\\pass\nline',
        database: 'app_db',
      };

      await driver.dropAllStatements(connection);

      expect(calls).toHaveLength(1);
      const [call] = calls;
      const [binary, defaultsArg, ...rest] = call?.command ?? [];

      expect(binary).toBe('mysql');
      expect(defaultsArg).toStartWith('--defaults-extra-file=');
      expect(rest).toEqual([
        '--host=127.0.0.1',
        `--port=${MYSQL_PORT}`,
        '--user=app_user',
        '--batch',
        '--raw',
        '--skip-column-names',
        `--execute=${EXPECTED_QUERY}`,
        'app_db',
      ]);
      expect(call?.command.join(' ')).not.toContain('s3"cret');
      expect(call?.optionsFileMode).toBe(OPTIONS_FILE_MODE);
      expect(call?.optionsFileContent).toBe(
        '[client]\npassword="s3\\"cret\\\\pass\\nline"\n',
      );
      expect(fs.readdirSync(tempRoot)).toEqual([]);
    });

    test('cleans up the temporary options directory even when the query fails', async () => {
      const { driver } = setupRunner(
        '',
        new UserError('mysql failed: access denied', 'client_failed'),
      );
      const connection: ConnectionConfig = {
        driver: 'mysql',
        password: 'secret',
        database: 'app_db',
      };

      const error = await driver
        .dropAllStatements(connection)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UserError);
      expect(fs.readdirSync(tempRoot)).toEqual([]);
    });

    test('omits unset host, port, user and password flags', async () => {
      const { driver, calls } = setupRunner('');

      await driver.dropAllStatements({ driver: 'mysql', database: 'app_db' });

      expect(calls[0]?.command).toEqual([
        'mysql',
        '--batch',
        '--raw',
        '--skip-column-names',
        `--execute=${EXPECTED_QUERY}`,
        'app_db',
      ]);
    });

    test('drops views before tables with foreign-key checks disabled and leaves routines and events untouched', async () => {
      const { driver } = setupRunner(
        [
          'active_users\tVIEW',
          'order_items\tBASE TABLE',
          'order_totals\tVIEW',
          'users\tBASE TABLE',
        ].join('\n'),
      );

      const sql = await driver.dropAllStatements({
        driver: 'mysql',
        database: 'app_db',
      });

      expect(sql).toBe(
        [
          'SET FOREIGN_KEY_CHECKS=0;',
          'DROP VIEW IF EXISTS `active_users`, `order_totals`;',
          'DROP TABLE IF EXISTS `order_items`, `users`;',
          'SET FOREIGN_KEY_CHECKS=1;',
        ].join('\n'),
      );
    });

    test('emits only DROP TABLE when there are no views', async () => {
      const { driver } = setupRunner('orders\tBASE TABLE\nusers\tBASE TABLE\n');

      const sql = await driver.dropAllStatements({
        driver: 'mysql',
        database: 'app_db',
      });

      expect(sql).toBe(
        [
          'SET FOREIGN_KEY_CHECKS=0;',
          'DROP TABLE IF EXISTS `orders`, `users`;',
          'SET FOREIGN_KEY_CHECKS=1;',
        ].join('\n'),
      );
    });

    test('emits only DROP VIEW when there are no tables', async () => {
      const { driver } = setupRunner('active_users\tVIEW\n');

      const sql = await driver.dropAllStatements({
        driver: 'mysql',
        database: 'app_db',
      });

      expect(sql).toBe(
        [
          'SET FOREIGN_KEY_CHECKS=0;',
          'DROP VIEW IF EXISTS `active_users`;',
          'SET FOREIGN_KEY_CHECKS=1;',
        ].join('\n'),
      );
    });

    test('returns an empty string when the database has no tables or views', async () => {
      const { driver } = setupRunner('');

      const sql = await driver.dropAllStatements({
        driver: 'mysql',
        database: 'app_db',
      });

      expect(sql).toBe('');
    });

    test('escapes embedded backticks in table and view identifiers', async () => {
      const { driver } = setupRunner(
        ['my`view\tVIEW', 'weird`table\tBASE TABLE'].join('\n'),
      );

      const sql = await driver.dropAllStatements({
        driver: 'mysql',
        database: 'app_db',
      });

      expect(sql).toBe(
        [
          'SET FOREIGN_KEY_CHECKS=0;',
          'DROP VIEW IF EXISTS `my``view`;',
          'DROP TABLE IF EXISTS `weird``table`;',
          'SET FOREIGN_KEY_CHECKS=1;',
        ].join('\n'),
      );
    });

    test('fails with config_invalid when database is missing or empty', async () => {
      const { driver, calls } = setupRunner('');

      for (const database of [undefined, '']) {
        const error = await driver
          .dropAllStatements({ driver: 'mysql', database })
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(UserError);
        expect((error as UserError).code).toBe('config_invalid');
      }

      expect(calls).toHaveLength(0);
    });
  });
});
