import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DUMP_DIR } from '../constants';
import { UserError, raise } from '../utils/exceptions';
import getDumpFiles from '../utils/get-dump-files';
import describeSnapshot from '../utils/describe-snapshot';
import { progress } from '../utils/output';
import { ask, confirm } from '../utils/prompt';
import { resolveProjectConnection } from '../utils/resolve-connection';
import { clientArgs } from '../utils/mysql-client-args';
import { runner } from '../utils/process-runner';
import type { Command } from '../types';

/**
 * Formats a dump file name
 *
 * @param name - The name of the dump file
 * @returns The formatted name
 * @throws If the name is not given
 */
function formatFilename(name: string): string {
  return (name || raise(new UserError('No dump file name provided', 'usage')))
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
    const { dumpName } = await ask<{ dumpName: string }>([
      {
        ...basePromptConfig,
        type: 'search',
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

  const { dumpName } = await ask<{ dumpName: string }>([
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
    const confirmed = await confirm(
      "You're sure you want to overwrite this file?",
    );

    if (!confirmed) {
      return;
    }
  }

  return dump;
}

const create: Command = async ({ args }) => {
  // Resolved first so a config problem fails before any Snapshot prompt.
  const { connection } = await resolveProjectConnection();

  runner.preflight('mysqldump');

  const dumpName = args.get(0);
  const dump = await getDump(
    dumpName === undefined ? undefined : String(dumpName),
  );

  if (!dump) {
    return;
  }

  progress('Creating dump file...');

  await runner.run(
    ['mysqldump', ...clientArgs(connection), '--opt', '--dump-date'],
    { stdout: (output) => Bun.write(dump.path, new Response(output)) },
  );

  return {
    kind: 'create',
    snapshot: describeSnapshot(dump.name, dump.path),
    overwritten: dump.exists,
  };
};

export default create;

export const options = {};
