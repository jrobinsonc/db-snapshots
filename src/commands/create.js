import CLI from 'clui';
import inquirer from 'inquirer';
import inquirerPrompt from 'inquirer-autocomplete-prompt';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import config from '../config.js';
import { DUMP_DIR } from '../constants.js';
import { UserError, raise } from '../utils/exceptions.js';
import getDumpFiles from '../utils/get-dump-files.js';
import logger from '../utils/logger.js';
import runMySqlCommand from '../utils/run-mysql-command.js';

inquirer.registerPrompt('autocomplete', inquirerPrompt);

/**
 * Formats a dump file name
 *
 * @param {string} name - The name of the dump file
 * @returns {string} The formatted name
 * @throws {UserError} If the name is not given
 */
function formatFilename(name) {
  return (name || raise(new UserError('No dump file name provided')))
    .trim()
    .replaceAll(/[^\da-z-]+/gi, '-')
    .replaceAll(/-+/g, '-');
}

/**
 * Ask dump file name
 *
 * @returns {Promise<string>} Promise that resolves with the dump file name
 */
async function askDumpName() {
  const filesList = await getDumpFiles();
  const basePromptConfig = {
    name: 'dumpName',
    message: 'Please enter the name for the dump file:',
  };

  if (filesList.length > 0) {
    const { dumpName } = await inquirer.prompt([
      {
        ...basePromptConfig,
        type: 'autocomplete',
        source: (_, searchText = '') => {
          const searchInputIsEmpty = searchText.length === 0;
          const filteredList = searchInputIsEmpty
            ? filesList
            : filesList.filter((element) => element.includes(searchText));
          const hasResults = filteredList.length > 0;

          if (!searchInputIsEmpty && !hasResults) {
            return [searchText];
          }

          return filteredList;
        },
      },
    ]);

    return dumpName;
  }

  const { dumpName } = await inquirer.prompt([
    {
      ...basePromptConfig,
      type: 'input',
    },
  ]);

  return dumpName;
}

/**
 * @typedef {object} DumpFile
 * @property {string} name - The name of the dump file
 * @property {string} path - The path to the dump file
 * @property {boolean} exists - Whether or not the dump file exists
 */

/**
 * Retrieves a dump file
 *
 * @param {string|undefined} dumpName - The name of the dump file to retrieve
 * @returns {Promise<DumpFile|null>} A promise that resolves with the dump file or null
 */
async function getDump(dumpName) {
  const dump = {
    name: dumpName || (await askDumpName()),
    path: '',
    exists: false,
  };

  dump.name = formatFilename(dump.name);
  dump.path = join(DUMP_DIR, `${dump.name}.sql`);
  dump.exists = existsSync(dump.path);

  // If the file already exists, ask if the user wants to overwrite it.
  if (dump.exists) {
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmOverwrite',
        message: "You're sure you want to overwrite this file?",
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

    await runMySqlCommand(
      `mysqldump -h ${connection.host} -P ${connection.port} -u ${connection.user} -p${connection.password} --opt --dump-date ${connection.database} > ${dump.path}`,
    );

    status.stop();
    logger.log(
      `Dump file ${dump.exists ? 'updated' : 'created'}: ${dump.name}`,
    );
  } catch (error) {
    status.stop();

    throw error;
  }
};
