import CLI from 'clui';
import inquirer from 'inquirer';
import inquirerPrompt from 'inquirer-autocomplete-prompt';
import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

inquirer.registerPrompt('autocomplete', inquirerPrompt);

import config from '../config.js';
import { DUMP_DIR } from '../constants.js';
import getDumpFiles from '../utils/get-dump-files.js';
import logger from '../utils/logger.js';

/**
 * Imports a dump file into the given connection.
 *
 * @param {object} connection - The connection to the host.
 * @param {string} dumpFile - The path of the dump file to be imported.
 * @returns {Promise} A promise that resolves when the import is complete.
 */
async function importDumpFile(connection, dumpFile) {
  return new Promise((resolve, reject) => {
    const procTimeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout'));
    }, 30_000);

    const proc = exec(
      `mysql -h ${connection.host} -P ${connection.port} -u ${connection.user} -p${connection.password} ${connection.database} < ${dumpFile}`,
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        clearTimeout(procTimeout);
        resolve(true);
      },
    );
  });
}

/**
 * Retrieves a dump file
 *
 * @param {string} dumpName - The name of the dump file to retrieve
 * @returns {Promise<object>} - A promise that resolves with the dump file
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
    logger.error(`Could not find dump: ${dump.name}`);

    return;
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
    await importDumpFile(connection, dump.path);
    status.stop();
    logger.success(`Dump file imported successfully: ${dump.name}`);
  } catch (error) {
    status.stop();

    throw error;
  }
};
