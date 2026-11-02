import fs from 'node:fs';
import path from 'node:path';

import pkg from '../../package.json';
import { UserError } from '../utils/exceptions';
import { CONFIG_FILE_NAME } from '../utils/find-config-file';
import type { ConnectionConfig } from '../utils/load-config';
import { ask as promptAsk } from '../utils/prompt';
import type { Command } from '../types';

/** The shipped schema, pinned to the release that wrote the config. */
const SCHEMA_URL = `https://raw.githubusercontent.com/jrobinsonc/db-snapshots/v${pkg.version}/db-snapshots.schema.json`;

/** The env var a typed password is moved to. */
const PASSWORD_ENV_VAR = 'DB_PASSWORD';

/** A whole-value `${VAR}` or `${VAR:-default}` reference. */
const ENV_REFERENCE = /^\$\{[A-Za-z_]\w*(?::-[^}]*)?\}$/;

/** What `init` writes for the password, and what the user must do about it. */
interface PasswordReference {
  /** The config value; undefined to omit the field. */
  value: string | undefined;
  /** The env var the user must set, or null when no literal was typed. */
  envVar: string | null;
}

/**
 * Decides what goes in the config for a typed password. A literal password is
 * never written: it is replaced by a reference to {@link PASSWORD_ENV_VAR}.
 *
 * @param typed - What the user typed at the password prompt.
 * @returns The value to write (undefined to omit the field) and the env var
 *   the user must set, or null when no literal password was typed.
 */
function toPasswordReference(typed: string): PasswordReference {
  if (typed === '') {
    return { value: undefined, envVar: null };
  }

  if (ENV_REFERENCE.test(typed)) {
    return { value: typed, envVar: null };
  }

  return { value: `\${${PASSWORD_ENV_VAR}}`, envVar: PASSWORD_ENV_VAR };
}

/**
 * Builds a prompt validator that rejects blank answers.
 *
 * @param message - Shown when the answer is blank.
 * @returns The validator.
 */
function nonBlank(message: string): (input: string) => true | string {
  return (input) => (input.trim() === '' ? message : true);
}

/**
 * @param configPath - The config that is in the way.
 * @returns The refusal raised when a config already exists.
 */
function configExists(configPath: string): UserError {
  return new UserError(
    `A config already exists at ${configPath}.`,
    'config_exists',
  );
}

/** The raw answers to the `init` prompts. */
interface Answers {
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

interface InitDeps {
  /** The prompt helper's `ask`. */
  ask: typeof promptAsk;
  /** The directory the config is written to. */
  cwd: () => string;
}

/**
 * Builds the `init` command.
 *
 * @param deps - Overridable collaborators, for tests.
 * @returns The command.
 */
export function createInit(deps: InitDeps): Command {
  return async () => {
    const configPath = path.join(deps.cwd(), CONFIG_FILE_NAME);

    if (fs.existsSync(configPath)) {
      throw configExists(configPath);
    }

    const answers = await deps.ask<Answers>([
      {
        type: 'input',
        name: 'name',
        message: 'Connection name:',
        default: 'local',
        validate: nonBlank('A Connection name is required.'),
      },
      {
        type: 'input',
        name: 'host',
        message: 'Host:',
        default: '127.0.0.1',
        validate: nonBlank('A host is required.'),
      },
      {
        type: 'input',
        name: 'port',
        message: 'Port:',
        default: '3306',
        validate: (input) =>
          /^\d+$/.test(input.trim()) ? true : 'The port must be a number.',
      },
      {
        type: 'input',
        name: 'user',
        message: 'User:',
        default: 'root',
        validate: nonBlank('A user is required.'),
      },
      {
        type: 'password',
        name: 'password',
        message: 'Password (leave empty for none, or type a ${VAR} reference):',
      },
      {
        type: 'input',
        name: 'database',
        message: 'Database:',
        validate: nonBlank('A database name is required.'),
      },
    ]);

    // The password is kept as typed: surrounding spaces may be part of it.
    const password = toPasswordReference(answers.password);
    const name = answers.name.trim();

    const connection: ConnectionConfig = {
      driver: 'mysql',
      host: answers.host.trim(),
      port: Number(answers.port.trim()),
      user: answers.user.trim(),
      ...(password.value === undefined ? {} : { password: password.value }),
      database: answers.database.trim(),
    };

    const config = {
      $schema: SCHEMA_URL,
      connections: { [name]: connection },
    };

    // `wx` refuses to replace a config created while the user was answering.
    try {
      fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
        flag: 'wx',
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw configExists(configPath);
      }

      throw error;
    }

    return {
      kind: 'init',
      config_file: configPath,
      connection: name,
      password_env_var: password.envVar,
    };
  };
}

export default createInit({ ask: promptAsk, cwd: () => process.cwd() });

export const options = {};
