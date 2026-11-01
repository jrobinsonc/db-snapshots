import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './constants';
import { UserError } from './utils/exceptions';
import logger from './utils/logger';
import parseCliArguments from './utils/parse-cli-arguments';
import type { Command } from './types';

const CLI_ARGUMENT_OFFSET = 2;
const [cmd, cmdArguments] = parseCliArguments(
  process.argv.slice(CLI_ARGUMENT_OFFSET),
);

try {
  if (!cmd) {
    throw new UserError('Please provide a valid command');
  }

  const commandFile = join(ROOT_DIR, 'src', 'commands', `${cmd}.ts`);

  if (!existsSync(commandFile)) {
    throw new UserError(`Command "${cmd}" does not exist.`);
  }

  const { default: commandFunction } = (await import(commandFile)) as {
    default: Command;
  };

  await commandFunction({
    args: cmdArguments,
  });
} catch (error) {
  if (error instanceof UserError) {
    logger.error(`Error: ${error.message}`);
    process.exit();
  }

  throw error;
}
