import type { Command } from '../types';
import type { CliOptionDefinitions } from '../utils/parse-cli-arguments';
import create, { options as createOptions } from './create';
import load, { options as loadOptions } from './load';

/** A command together with the option declarations used to parse its flags. */
export interface RegisteredCommand {
  run: Command;
  options: CliOptionDefinitions;
}

const commands: Readonly<Record<string, RegisteredCommand>> = {
  create: { run: create, options: createOptions },
  load: { run: load, options: loadOptions },
};

/**
 * Looks up a command in the static registry.
 *
 * @param name - The command name typed by the user.
 * @returns The registered command, or undefined when the name is unknown.
 */
export function getCommand(name: string): RegisteredCommand | undefined {
  return Object.hasOwn(commands, name) ? commands[name] : undefined;
}
