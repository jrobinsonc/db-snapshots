import pkg from '../package.json';
import { getCommand, listCommands } from './commands';
import { UserError } from './utils/exceptions';
import { renderCommandHelp, renderGeneralHelp } from './utils/help';
import logger from './utils/logger';
import parseCliArguments from './utils/parse-cli-arguments';

const CLI_ARGUMENT_OFFSET = 2;

const EXIT_USER_ERROR = 1;
const EXIT_USAGE_ERROR = 2;

try {
  const commandLineArguments = process.argv.slice(CLI_ARGUMENT_OFFSET);

  if (commandLineArguments.includes('--version')) {
    console.log(pkg.version);
    process.exit(0);
  }

  const wantsHelp =
    commandLineArguments.includes('--help') ||
    commandLineArguments.includes('-h');
  const positionals = commandLineArguments.filter(
    (argument) => !argument.startsWith('-'),
  );
  const isHelpCommand = positionals[0] === 'help';
  const helpTarget = isHelpCommand ? positionals[1] : positionals[0];

  if (wantsHelp || isHelpCommand) {
    if (helpTarget === undefined) {
      console.log(renderGeneralHelp(listCommands()));
      process.exit(0);
    }

    const target = getCommand(helpTarget);

    if (!target) {
      throw new UserError(`Command "${helpTarget}" does not exist.`, 'usage');
    }

    console.log(renderCommandHelp(helpTarget, target));
    process.exit(0);
  }

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
} catch (caught) {
  // yargs rejects unknown or invalid flags with a YError.
  const error =
    caught instanceof Error && caught.name === 'YError'
      ? new UserError(caught.message, 'usage')
      : caught;

  if (error instanceof UserError) {
    logger.error(`Error: ${error.message}`);

    process.exit(error.code === 'usage' ? EXIT_USAGE_ERROR : EXIT_USER_ERROR);
  }

  logger.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );

  process.exit(EXIT_USER_ERROR);
}
