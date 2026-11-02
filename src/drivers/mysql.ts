import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UserError } from '../utils/exceptions';
import type { ConnectionConfig } from '../utils/load-config';
import { runner as defaultRunner } from '../utils/process-runner';
import type { ProcessRunner } from '../utils/process-runner';
import type { ClientCredentials, Driver } from './types';

/** Owner read/write only: the options file holds the password. */
const OPTIONS_FILE_MODE = 0o600;

const BASE_DUMP_FLAGS = [
  '--single-transaction',
  '--quick',
  '--no-tablespaces',
  '--skip-comments',
];

/** MariaDB's mysqldump rejects this flag, so it is only added for MySQL. */
const MYSQL_ONLY_DUMP_FLAGS = ['--set-gtid-purged=OFF'];

interface MysqlDriverDeps {
  runner: ProcessRunner;
  /** Directory the temporary options file is created in. */
  tempDir: () => string;
}

/**
 * Escapes a value for a double-quoted MySQL option-file value.
 *
 * @param value - The raw value.
 * @returns The quoted, escaped value.
 */
function quoteOptionValue(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');

  return `"${escaped}"`;
}

/**
 * Quotes an identifier for MySQL.
 *
 * @param name - The identifier.
 * @returns The backtick-quoted identifier.
 */
function quoteIdentifier(name: string): string {
  return `\`${name.replaceAll('`', '``')}\``;
}

/**
 * Reads the database name a client invocation needs.
 *
 * @param connection - The Connection.
 * @returns Its database name.
 * @throws {UserError} with code `config_invalid` when it has none.
 */
function requireDatabase(connection: ConnectionConfig): string {
  if (connection.database === undefined || connection.database === '') {
    throw new UserError(
      'The Connection has no "database" set. Add it to .db-snapshots.json.',
      'config_invalid',
    );
  }

  return connection.database;
}

/**
 * Builds the host, port and user flags. Unset fields are left out so the
 * client's own defaults apply. The password is never among them.
 *
 * @param connection - The Connection.
 * @returns The flags, one per element.
 */
function connectionArgs(connection: ConnectionConfig): string[] {
  const args = [
    connection.host === undefined ? undefined : `--host=${connection.host}`,
    connection.port === undefined ? undefined : `--port=${connection.port}`,
    connection.user === undefined ? undefined : `--user=${connection.user}`,
  ];

  return args.filter((arg) => arg !== undefined);
}

/**
 * Reads a process's stdout fully as text.
 *
 * @returns A consumer for `RunOptions.stdout` and a getter for what it read.
 */
function captureStdout(): {
  stdout: (output: ReadableStream<Uint8Array>) => Promise<unknown>;
  text: () => string;
} {
  let captured = '';

  return {
    stdout: async (output) => {
      captured = await new Response(output).text();
    },
    text: () => captured,
  };
}

/**
 * Builds the `mysql` Driver (MySQL and MariaDB).
 *
 * @param deps - Overridable collaborators, for tests.
 * @returns The Driver.
 */
export function createMysqlDriver(deps: MysqlDriverDeps): Driver {
  const binaries = { dump: 'mysqldump', load: 'mysql' } as const;
  /** Cached probe of whether the dump client is MariaDB's. */
  let dumpClientIsMariaDb: Promise<boolean> | undefined;

  /**
   * Runs one query through the `mysql` client.
   *
   * @param connection - The Connection to query.
   * @param sql - The query.
   * @returns The rows, each split into its tab-separated columns.
   */
  async function query(
    connection: ConnectionConfig,
    sql: string,
  ): Promise<string[][]> {
    const database = requireDatabase(connection);
    const capture = captureStdout();

    await driver.withCredentials(connection, (credentials) =>
      deps.runner.run(
        [
          binaries.load,
          ...credentials.args,
          ...connectionArgs(connection),
          '--batch',
          '--raw',
          '--skip-column-names',
          `--execute=${sql}`,
          database,
        ],
        { stdout: capture.stdout, env: credentials.env },
      ),
    );

    return capture
      .text()
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split('\t'));
  }

  const driver: Driver = {
    name: 'mysql',
    binaries,

    async defaultDumpFlags() {
      // The flag set depends on the dump client, not the server.
      dumpClientIsMariaDb ??= (async () => {
        const capture = captureStdout();

        await deps.runner.run([binaries.dump, '--version'], {
          stdout: capture.stdout,
        });

        return /mariadb/i.test(capture.text());
      })().catch((error: unknown) => {
        // Don't cache a failed probe; the next call retries it.
        dumpClientIsMariaDb = undefined;

        throw error;
      });

      return (await dumpClientIsMariaDb)
        ? [...BASE_DUMP_FLAGS]
        : [...BASE_DUMP_FLAGS, ...MYSQL_ONLY_DUMP_FLAGS];
    },

    async withCredentials<T>(
      connection: ConnectionConfig,
      use: (credentials: ClientCredentials) => Promise<T>,
    ): Promise<T> {
      const password = connection.password ?? '';

      if (password === '') {
        return use({ args: [], env: {} });
      }

      const dir = await mkdtemp(join(deps.tempDir(), 'dbs-'));

      try {
        const optionsFile = join(dir, 'client.cnf');

        await writeFile(
          optionsFile,
          `[client]\npassword=${quoteOptionValue(password)}\n`,
          { mode: OPTIONS_FILE_MODE },
        );

        // The client requires this to be its first argument.
        return await use({
          args: [`--defaults-extra-file=${optionsFile}`],
          env: {},
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },

    async listTables(connection) {
      const rows = await query(
        connection,
        'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME',
      );

      return rows.map(([name = '']) => name);
    },

    async dropAllStatements(connection) {
      const rows = await query(
        connection,
        'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME',
      );
      const views: string[] = [];
      const tables: string[] = [];

      for (const [name = '', type] of rows) {
        (type === 'VIEW' ? views : tables).push(quoteIdentifier(name));
      }

      if (views.length === 0 && tables.length === 0) {
        return '';
      }

      // Triggers go with their tables; routines and events are left alone.
      return [
        'SET FOREIGN_KEY_CHECKS=0;',
        views.length > 0 ? `DROP VIEW IF EXISTS ${views.join(', ')};` : '',
        tables.length > 0 ? `DROP TABLE IF EXISTS ${tables.join(', ')};` : '',
        'SET FOREIGN_KEY_CHECKS=1;',
      ]
        .filter((statement) => statement !== '')
        .join('\n');
    },

    async dump(connection, options) {
      const database = requireDatabase(connection);
      const tables = options.tables ?? [];
      const ignored =
        tables.length > 0
          ? []
          : (options.exclude ?? []).map(
              (table) => `--ignore-table=${database}.${table}`,
            );
      const defaultFlags = await driver.defaultDumpFlags();

      await driver.withCredentials(connection, (credentials) =>
        deps.runner.run(
          [
            binaries.dump,
            ...credentials.args,
            ...connectionArgs(connection),
            ...defaultFlags,
            ...ignored,
            ...(options.extraOptions ?? []),
            database,
            ...tables,
          ],
          { stdout: options.stdout, env: credentials.env },
        ),
      );
    },

    async load(connection, options) {
      const database = requireDatabase(connection);

      await driver.withCredentials(connection, (credentials) =>
        deps.runner.run(
          [
            binaries.load,
            ...credentials.args,
            ...connectionArgs(connection),
            ...(options.extraOptions ?? []),
            database,
          ],
          { stdin: options.input, env: credentials.env },
        ),
      );
    },
  };

  return driver;
}

/** The `mysql` Driver every command uses. */
export const mysqlDriver: Driver = createMysqlDriver({
  runner: defaultRunner,
  tempDir: tmpdir,
});
