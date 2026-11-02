import { UserError } from './exceptions';
import { findConfigFile } from './find-config-file';
import { loadConfig } from './load-config';
import type { ConnectionConfig, ProjectConfig } from './load-config';
import { ask as promptAsk } from './prompt';

/** The Connection a command runs against. */
export interface ResolvedConnection {
  name: string;
  connection: ConnectionConfig;
}

/** A Connection name proposed by one step of the chain. */
interface Candidate {
  name: string;
  /** Where the name came from, shown when it is not a Connection. */
  source: string;
}

/**
 * One step of the resolution chain.
 *
 * @returns The proposed name, or undefined to defer to the next step.
 */
type ResolutionStep = (
  config: ProjectConfig,
) => Candidate | undefined | Promise<Candidate | undefined>;

interface ResolverDeps {
  /** The prompt helper's `ask`. */
  ask: typeof promptAsk;
}

/**
 * Lists the Connection names for error messages.
 *
 * @param config - The project config.
 * @returns The Connection names, comma separated.
 */
function listNames(config: ProjectConfig): string {
  return Object.keys(config.connections).join(', ');
}

const fromDefaultConnection: ResolutionStep = (config) =>
  config.default_connection === undefined
    ? undefined
    : { name: config.default_connection, source: '"default_connection"' };

const fromOnlyConnection: ResolutionStep = (config) => {
  const names = Object.keys(config.connections);

  return names.length === 1 && names[0] !== undefined
    ? { name: names[0], source: 'the only Connection' }
    : undefined;
};

/**
 * Builds the last step: an interactive picker, or a user error listing the
 * Connection names when no one can answer.
 *
 * @param deps - The prompt helper.
 * @returns The step.
 */
function fromPicker(deps: ResolverDeps): ResolutionStep {
  return async (config) => {
    try {
      const { name } = await deps.ask<{ name: string }>([
        {
          type: 'select',
          name: 'name',
          message: 'Select the Connection:',
          choices: Object.keys(config.connections),
        },
      ]);

      return { name, source: 'the picker' };
    } catch (error) {
      if (error instanceof UserError && error.code === 'input_required') {
        throw new UserError(
          `No Connection could be resolved and prompting is disabled. Set "default_connection" to one of: ${listNames(config)}.`,
          'input_required',
        );
      }

      throw error;
    }
  };
}

/**
 * Builds the Connection resolver used by `create` and `load`. Steps run in
 * order and the first name proposed wins; an unknown name is an error and
 * never falls through. `--connection` and `DB_SNAPSHOTS_CONNECTION` go at the
 * top of the chain.
 *
 * @param deps - Overridable collaborators, for tests.
 * @returns The resolver.
 */
export function createConnectionResolver(deps: ResolverDeps) {
  const steps: ResolutionStep[] = [
    fromDefaultConnection,
    fromOnlyConnection,
    fromPicker(deps),
  ];

  /**
   * Resolves the target Connection.
   *
   * @param config - The project config.
   * @returns The Connection and its name.
   * @throws {UserError} with code `connection_not_found` when a step proposes
   *   an unknown name, or `input_required` when the picker cannot be shown.
   */
  return async function resolveConnection(
    config: ProjectConfig,
  ): Promise<ResolvedConnection> {
    for (const step of steps) {
      const candidate = await step(config);

      if (candidate === undefined) {
        continue;
      }

      const connection = Object.hasOwn(config.connections, candidate.name)
        ? config.connections[candidate.name]
        : undefined;

      if (connection === undefined) {
        throw new UserError(
          `Connection "${candidate.name}" (from ${candidate.source}) is not defined. Available: ${listNames(config)}.`,
          'connection_not_found',
        );
      }

      return { name: candidate.name, connection };
    }

    // The picker always proposes a name or throws.
    throw new Error('Connection resolution chain ended without a result');
  };
}

/** Resolves a Connection from a loaded config, prompting through the real prompt helper. */
export const resolveConnection = createConnectionResolver({ ask: promptAsk });

/**
 * Finds and loads the project config, then resolves the Connection to use.
 *
 * @returns The Connection and its name, with the config it came from.
 */
export async function resolveProjectConnection(): Promise<
  ResolvedConnection & { config: ProjectConfig }
> {
  const config = loadConfig(findConfigFile());

  return { ...(await resolveConnection(config)), config };
}
