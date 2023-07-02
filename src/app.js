import { join } from 'node:path';

import { ROOT_DIR } from './constants.js';
import logger from './utils/logger.js';
import parseCliArguments from './utils/parse-cli-arguments.js';

const [cmd, cmdArguments] = parseCliArguments(process.argv.slice(2));

if (!cmd) {
  logger.error('Please provide a valid command');
  process.exit(1);
}

const commandFile = join(ROOT_DIR, 'src', 'commands', `${cmd}.js`);

try {
  const { default: commandFunction } = await import(commandFile);

  commandFunction({
    args: cmdArguments,
  });
} catch (error) {
  if (
    error.code === 'ERR_MODULE_NOT_FOUND' &&
    error.message.includes(`Cannot find module '${commandFile}'`)
  ) {
    logger.error(`Unknown command "${cmd}"`);
    process.exit(1);
  }

  throw error;
}
