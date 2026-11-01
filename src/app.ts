import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './constants';
import { UserError } from './utils/exceptions';
import logger from './utils/logger';
import parseCliArguments, {
  type CliOptionDefinitions,
} from './utils/parse-cli-arguments';
import type { Command } from './types';

const CLI_ARGUMENT_OFFSET = 2;

try {
  const commandLineArguments = process.argv.slice(CLI_ARGUMENT_OFFSET);
  const [commandName] = parseCliArguments(commandLineArguments);

  if (!commandName) {
    throw new UserError('Please provide a valid command');
  }

  const commandFile = join(ROOT_DIR, 'src', 'commands', `${commandName}.ts`);

  if (!existsSync(commandFile)) {
    throw new UserError(`Command "${commandName}" does not exist.`);
  }

  const importedCommand = (await import(commandFile)) as {
    default: Command;
    options?: CliOptionDefinitions;
  };

  const [, cmdArguments] = parseCliArguments(
    commandLineArguments,
    importedCommand.options ?? {},
  );

  await importedCommand.default({
    args: cmdArguments,
  });
} catch (error) {
  if (
    error instanceof UserError ||
    (error instanceof Error && error.name === 'YError')
  ) {
    logger.error(`Error: ${error.message}`);
    process.exit();
  }

  throw error;
}
