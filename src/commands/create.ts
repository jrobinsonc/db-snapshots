import CLI from 'clui';
import inquirer from 'inquirer';
import inquirerPrompt from 'inquirer-autocomplete-prompt';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import config from '../config';
import { DUMP_DIR } from '../constants';
import { UserError, raise } from '../utils/exceptions';
import getDumpFiles from '../utils/get-dump-files';
import logger from '../utils/logger';
import runMySqlCommand from '../utils/run-mysql-command';
import type { Command } from '../types';

inquirer.registerPrompt('autocomplete', inquirerPrompt);

/**
 * Formats a dump file name
 *
 * @param name - The name of the dump file
 * @returns The formatted name
 * @throws If the name is not given
 */
function formatFilename(name: string): string {
  return (name || raise(new UserError('No dump file name provided')))
    .trim()
    .replaceAll(/[^\da-z-]+/gi, '-')
    .replaceAll(/-+/g, '-');
}

/**
 * Ask dump file name
 *
 * @returns Promise that resolves with the dump file name
 */
async function askDumpName(): Promise<string> {
  const filesList = await getDumpFiles();
  const basePromptConfig = {
    name: 'dumpName',
    message: 'Please enter the name for the dump file:',
  };

  if (filesList.length > 0) {
    const { dumpName } = await inquirer.prompt<{ dumpName: string }>([
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

  const { dumpName } = await inquirer.prompt<{ dumpName: string }>([
    {
      ...basePromptConfig,
      type: 'input',
    },
  ]);

  return dumpName;
}

interface DumpFile {
  /** The name of the dump file */
  name: string;
  /** The path to the dump file */
  path: string;
  /** Whether or not the dump file exists */
  exists: boolean;
}

/**
 * Retrieves a dump file
 *
 * @param dumpName - The name of the dump file to retrieve
 * @returns A promise that resolves with the dump file, or undefined if the user declines to overwrite it
 */
async function getDump(
  dumpName: string | undefined,
): Promise<DumpFile | undefined> {
  const dump: DumpFile = {
    name: dumpName || (await askDumpName()),
    path: '',
    exists: false,
  };

  dump.name = formatFilename(dump.name);
  dump.path = join(DUMP_DIR, `${dump.name}.sql`);
  dump.exists = existsSync(dump.path);

  // If the file already exists, ask if the user wants to overwrite it.
  if (dump.exists) {
    const answers = await inquirer.prompt<{ confirmOverwrite: boolean }>([
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

const create: Command = async ({ args }) => {
  const dumpName = args.get(0);
  const dump = await getDump(
    dumpName === undefined ? undefined : String(dumpName),
  );

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

export default create;

export const options = {};
