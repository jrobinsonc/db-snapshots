import CLI from 'clui';
import inquirer from 'inquirer';
import inquirerPrompt from 'inquirer-autocomplete-prompt';
import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import config from '../config.js';
import { DUMP_DIR } from '../constants.js';
import getDumpFiles from '../utils/get-dump-files.js';
import logger from '../utils/logger.js';

inquirer.registerPrompt('autocomplete', inquirerPrompt);

/**
 * Formats a dump file name
 *
 * @param {string} name - The name of the dump file
 * @returns {string} - The formatted name
 */
function formatFilename(name) {
  return name
    .trim()
    .replaceAll(/[^\da-z-]+/gi, '-')
    .replaceAll(/-+/g, '-');
}

/**
 * Exports a database to a dump file
 *
 * @param {object} connection - The connection object
 * @param {string} dumpFile - The path of the dump file
 * @returns {Promise} - A promise that resolves when the export is complete
 */
async function createDumpFile(connection, dumpFile) {
  return new Promise((resolve, reject) => {
    const procTimeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout'));
    }, 30_000);

    const proc = exec(
      `mysqldump -h ${connection.host} -P ${connection.port} -u ${connection.user} -p${connection.password} --opt --dump-date ${connection.database} > ${dumpFile}`,
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
    dump.name = formatFilename(dumpName);
  } else {
    const createNewText = 'CREATE NEW: ';
    const fileList = await getDumpFiles();
    const answers = await inquirer.prompt([
      {
        type: 'autocomplete',
        name: 'dumpName',
        message: 'Type the name for the dump file:',
        source: (_, input = '') => {
          const list = fileList.filter((element) => element.includes(input));

          if (input.length > 0 && list.length === 0) {
            return [`${createNewText}${input}`];
          }

          return list;
        },
      },
    ]);

    // const answers = await inquirer.prompt([
    //   {
    //     type: 'input',
    //     name: 'dumpName',
    //     message: 'Dump name:',
    //     default: new Date().toISOString().replaceAll(/\D/g, ''),
    //   },
    // ]);

    dump.name = formatFilename(answers.dumpName.replace(createNewText, ''));
  }

  dump.path = join(DUMP_DIR, `${dump.name}.sql`);

  // If the file already exists, ask if the user wants to overwrite it.
  if (existsSync(dump.path)) {
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmOverwrite',
        message: 'This file already exists, do you want to overwrite it?',
        default: true,
      },
    ]);

    if (!answers.confirmOverwrite) {
      return;
    }
  }

  return dump;
}

export default async ({ args }) => {
  const dump = await getDump(args.get(0));

  if (!dump) {
    return;
  }

  const connection = await config.getAppConnection();
  const status = new CLI.Spinner('Creating dump file...');

  try {
    status.start();
    await createDumpFile(connection, dump.path);
    status.stop();
    logger.success(`Dump file has been created successfully: ${dump.name}`);
  } catch (error) {
    status.stop();

    throw error;
  }
};
