import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './constants.js';
import { UserError } from './utils/exceptions.js';
import logger from './utils/logger.js';
import parseCliArguments from './utils/parse-cli-arguments.js';

const [cmd, cmdArguments] = parseCliArguments(process.argv.slice(2));

try {
  if (!cmd) {
    throw new UserError('Please provide a valid command');
  }

  const commandFile = join(ROOT_DIR, 'src', 'commands', `${cmd}.js`);

  if (!existsSync(commandFile)) {
    throw new UserError(`Command "${cmd}" does not exist.`);
  }

  const { default: commandFunction } = await import(commandFile);

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
