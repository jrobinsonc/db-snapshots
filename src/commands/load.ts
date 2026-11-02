import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DUMP_DIR } from '../constants';
import { UserError } from '../utils/exceptions';
import getDumpFiles from '../utils/get-dump-files';
import describeSnapshot from '../utils/describe-snapshot';
import { progress } from '../utils/output';
import { ask } from '../utils/prompt';
import { resolveProjectConnection } from '../utils/resolve-connection';
import { getDriver } from '../drivers';
import { runner } from '../utils/process-runner';
import type { Command } from '../types';

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
 * @returns A promise that resolves with the dump file
 */
async function getDump(dumpName: string | undefined): Promise<DumpFile> {
  const dump: DumpFile = { name: '', path: '' };

  if (dumpName) {
    dump.name = dumpName
      .trim()
      .replaceAll(/[^\da-z-]+/gi, '-')
      .replaceAll(/-+/g, '-');
  } else {
    const fileList = await getDumpFiles();

    if (fileList.length === 0) {
      throw new UserError('No dump files found', 'snapshot_not_found');
    }

    const answers = await ask<{ dumpName: string }>([
      {
        type: 'search',
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
    throw new UserError(
      `This dump file doesn't exist: ${dump.name}`,
      'snapshot_not_found',
    );
  }

  return dump;
}

const load: Command = async ({ args }) => {
  const dumpName = args.get(0);
  const dump = await getDump(
    dumpName === undefined ? undefined : String(dumpName),
  );

  const { name, connection } = await resolveProjectConnection();
  const driver = getDriver(connection.driver);

  runner.preflight(driver.binaries.load);

  const startedAt = Date.now();

  progress('Loading dump file...');

  await driver.load(connection, { input: Bun.file(dump.path) });

  return {
    kind: 'load',
    snapshot: describeSnapshot(dump.name, dump.path),
    connection: name,
    dropped: false,
    duration_ms: Date.now() - startedAt,
  };
};

export default load;

export const options = {};
