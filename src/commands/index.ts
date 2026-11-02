import type { Command } from '../types';
import type { CliOptionDefinitions } from '../utils/parse-cli-arguments';
import create, { options as createOptions } from './create';
import init, { options as initOptions } from './init';
import list, { options as listOptions } from './list';
import load, { options as loadOptions } from './load';

/** A command together with the option declarations used to parse its flags. */
export interface RegisteredCommand {
  run: Command;
  /** One-line summary shown in help. */
  description: string;
  /** Positional arguments, as shown after the command name in help. */
  usage: string;
  options: CliOptionDefinitions;
}

const commands: Readonly<Record<string, RegisteredCommand>> = {
  init: {
    run: init,
    options: initOptions,
    description: 'Create a .db-snapshots.json config interactively.',
    usage: '',
  },
  create: {
    run: create,
    options: createOptions,
    description: 'Create a snapshot of the database.',
    usage: '[name]',
  },
  load: {
    run: load,
    options: loadOptions,
    description: 'Load a snapshot into the database.',
    usage: '[name]',
  },
  list: {
    run: list,
    options: listOptions,
    description: 'List the snapshots in the Snapshot Storage.',
    usage: '',
  },
};

/**
 * @returns All registered commands keyed by name.
 */
export function listCommands(): Readonly<Record<string, RegisteredCommand>> {
  return commands;
}

/**
 * Looks up a command in the static registry.
 *
 * @param name - The command name typed by the user.
 * @returns The registered command, or undefined when the name is unknown.
 */
export function getCommand(name: string): RegisteredCommand | undefined {
  return Object.hasOwn(commands, name) ? commands[name] : undefined;
}
