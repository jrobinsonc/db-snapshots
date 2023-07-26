import CLI from 'clui';
import inquirer from 'inquirer';
import inquirerPrompt from 'inquirer-autocomplete-prompt';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import config from '../config.js';
import { DUMP_DIR } from '../constants.js';
import { UserError } from '../utils/exceptions.js';
import getDumpFiles from '../utils/get-dump-files.js';
import logger from '../utils/logger.js';
import runMySqlCommand from '../utils/run-mysql-command.js';

inquirer.registerPrompt('autocomplete', inquirerPrompt);

/**
 * Retrieves a dump file
 *
 * @param {string} dumpName - The name of the dump file to retrieve
 * @returns {Promise<object>} A promise that resolves with the dump file
 */
async function getDump(dumpName) {
  const dump = { name: '', path: '' };

  if (dumpName) {
    dump.name = dumpName
      .trim()
      .replaceAll(/[^\da-z-]+/gi, '-')
      .replaceAll(/-+/g, '-');
  } else {
    const fileList = await getDumpFiles();

    if (fileList.length === 0) {
      logger.error('No dump files found');

      return;
    }

    const answers = await inquirer.prompt([
      {
        type: 'autocomplete',
        name: 'dumpName',
        message: 'Select the dump:',
        source: (_, input = '') => {
          return fileList.filter((element) => element.includes(input));
        },
      },
    ]);

    dump.name = answers.dumpName;
  }

  dump.path = join(DUMP_DIR, `${dump.name}.sql`);

  if (!existsSync(dump.path)) {
    throw new UserError(`This dump file doesn't exist: ${dump.name}`);
  }

  return dump;
}

export default async ({ args }) => {
  const dump = await getDump(args.get(0));

  if (!dump) {
    return;
  }

  const connection = await config.getAppConnection();
  const status = new CLI.Spinner('Loading dump file...');

  try {
    status.start();

    await runMySqlCommand(
      `mysql -h ${connection.host} -P ${connection.port} -u ${connection.user} -p${connection.password} ${connection.database} < ${dump.path}`,
    );

    status.stop();
    logger.success(`Dump file imported: ${dump.name}`);
  } catch (error) {
    status.stop();

    throw error;
  }
};
