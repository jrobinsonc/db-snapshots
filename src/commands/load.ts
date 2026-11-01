import CLI from 'clui';
import inquirer from 'inquirer';
import inquirerPrompt from 'inquirer-autocomplete-prompt';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import config from '../config';
import { DUMP_DIR } from '../constants';
import { UserError } from '../utils/exceptions';
import getDumpFiles from '../utils/get-dump-files';
import logger from '../utils/logger';
import runMySqlCommand from '../utils/run-mysql-command';
import type { Command } from '../types';

inquirer.registerPrompt('autocomplete', inquirerPrompt);

interface DumpFile {
  /** The name of the dump file */
  name: string;
  /** The path to the dump file */
  path: string;
}

/**
 * Retrieves a dump file
 *
 * @param dumpName - The name of the dump file to retrieve
 * @returns A promise that resolves with the dump file, or undefined if there are no dump files to choose from
 */
async function getDump(
  dumpName: string | undefined,
): Promise<DumpFile | undefined> {
  const dump: DumpFile = { name: '', path: '' };

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

    const answers = await inquirer.prompt<{ dumpName: string }>([
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

const load: Command = async ({ args }) => {
  const dumpName = args.get(0);
  const dump = await getDump(
    dumpName === undefined ? undefined : String(dumpName),
  );

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

export default load;
