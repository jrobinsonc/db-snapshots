import { getCommand } from './commands';
import { UserError } from './utils/exceptions';
import logger from './utils/logger';
import parseCliArguments from './utils/parse-cli-arguments';

const CLI_ARGUMENT_OFFSET = 2;

const EXIT_USER_ERROR = 1;
const EXIT_USAGE_ERROR = 2;

try {
  const commandLineArguments = process.argv.slice(CLI_ARGUMENT_OFFSET);
  const [commandName] = parseCliArguments(commandLineArguments);

  if (typeof commandName !== 'string' || commandName.length === 0) {
    throw new UserError('Please provide a valid command', 'usage');
  }

  const command = getCommand(commandName);

  if (!command) {
    throw new UserError(`Command "${commandName}" does not exist.`, 'usage');
  }

  const [, commandArguments] = parseCliArguments(
    commandLineArguments,
    command.options,
  );

  await command.run({ args: commandArguments });
} catch (error) {
  if (error instanceof UserError) {
    logger.error(`Error: ${error.message}`);

    process.exit(error.code === 'usage' ? EXIT_USAGE_ERROR : EXIT_USER_ERROR);
  }

  // yargs rejects unknown or invalid flags with a YError.
  if (error instanceof Error && error.name === 'YError') {
    logger.error(`Error: ${error.message}`);

    process.exit(EXIT_USAGE_ERROR);
  }

  logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));

  process.exit(EXIT_USER_ERROR);
}
