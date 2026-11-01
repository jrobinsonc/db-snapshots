import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { UserError } from '../../src/utils/exceptions';
import { CONFIG_FILE_NAME } from '../../src/utils/find-config-file';
import { loadConfig } from '../../src/utils/load-config';

const LOCAL = { driver: 'mysql', database: 'app' } as const;

describe('utils/loadConfig', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbs-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeConfig(content: unknown): string {
    const file = path.join(root, CONFIG_FILE_NAME);
    fs.writeFileSync(
      file,
      typeof content === 'string' ? content : JSON.stringify(content),
    );

    return file;
  }

  function loadError(content: unknown): UserError {
    try {
      loadConfig(writeConfig(content));
    } catch (error) {
      expect(error).toBeInstanceOf(UserError);
      expect((error as UserError).code).toEqual('config_invalid');

      return error as UserError;
    }

    throw new Error('expected loadConfig to throw');
  }

  test('it defaults storage to snapshots next to the config file', () => {
    const config = loadConfig(writeConfig({ connections: { local: LOCAL } }));

    expect(config.storage).toEqual(path.join(root, 'snapshots'));
    expect(config.connections).toEqual({ local: LOCAL });
  });

  test('it resolves a relative storage against the config directory', () => {
    const config = loadConfig(
      writeConfig({ storage: 'var/dumps', connections: { local: LOCAL } }),
    );

    expect(config.storage).toEqual(path.join(root, 'var', 'dumps'));
  });

  test('it keeps an absolute storage as given', () => {
    const config = loadConfig(
      writeConfig({ storage: '/srv/dumps', connections: { local: LOCAL } }),
    );

    expect(config.storage).toEqual('/srv/dumps');
  });

  test('it rejects an unknown top-level field, naming it', () => {
    const error = loadError({
      cleanup: { keep: 2 },
      connections: { local: LOCAL },
    });

    expect(error.message).toContain('cleanup');
  });

  test('it rejects a not-yet-supported Connection field, naming its path', () => {
    const error = loadError({
      connections: { local: { ...LOCAL, compress: true } },
    });

    expect(error.message).toContain('connections.local.compress');
  });

  test('it requires the connections field', () => {
    expect(loadError({ storage: 'snapshots' }).message).toContain(
      'connections',
    );
  });

  test('it requires at least one Connection', () => {
    expect(loadError({ connections: {} }).message).toContain('connections');
  });

  test('it accepts port as a number or an interpolated string', () => {
    const config = loadConfig(
      writeConfig({
        connections: {
          a: { ...LOCAL, port: 3306 },
          b: { ...LOCAL, port: '${DB_PORT:-3306}' },
        },
      }),
    );

    expect(config.connections['a']?.port).toEqual(3306);
    expect(config.connections['b']?.port).toEqual('${DB_PORT:-3306}');
  });

  test('it rejects a port that is neither a number nor a string', () => {
    const error = loadError({
      connections: { local: { ...LOCAL, port: true } },
    });

    expect(error.message).toContain('connections.local.port');
  });

  test('it rejects a Driver this release does not support', () => {
    const error = loadError({
      connections: { local: { ...LOCAL, driver: 'pgsql' } },
    });

    expect(error.message).toContain('connections.local.driver');
  });

  test('it accepts every v0.1.0 field, including a $schema reference', () => {
    const local = {
      driver: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '${DB_PASSWORD}',
      database: 'app',
    } as const;

    const config = loadConfig(
      writeConfig({
        $schema: './db-snapshots.schema.json',
        default_connection: 'local',
        storage: 'snapshots',
        connections: { local },
      }),
    );

    expect(config.default_connection).toEqual('local');
    expect(config.connections).toEqual({ local });
  });

  test('it reports malformed JSON as an invalid config', () => {
    const error = loadError('{ "connections": ');

    expect(error.message).toContain(CONFIG_FILE_NAME);
  });
});
