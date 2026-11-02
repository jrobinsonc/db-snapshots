import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UserError } from '../utils/exceptions';
import describeSnapshot from '../utils/describe-snapshot';
import { findConfigFile } from '../utils/find-config-file';
import { loadConfig } from '../utils/load-config';
import { progress } from '../utils/output';
import { ask } from '../utils/prompt';
import { resolveConnection } from '../utils/resolve-connection';
import { listSnapshots } from '../utils/snapshot-repository';
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
 * @param storage - The Snapshot Storage directory.
 * @returns A promise that resolves with the dump file
 */
async function getDump(
  dumpName: string | undefined,
  storage: string,
): Promise<DumpFile> {
  const dump: DumpFile = { name: '', path: '' };

  if (dumpName) {
    dump.name = dumpName
      .trim()
      .replaceAll(/[^\da-z-]+/gi, '-')
      .replaceAll(/-+/g, '-');
  } else {
    // Newest first, so the picker opens on the latest Snapshot.
    const fileList = (await listSnapshots(storage)).map(({ name }) => name);

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

  dump.path = join(storage, `${dump.name}.sql`);

  if (!existsSync(dump.path)) {
    throw new UserError(
      `This dump file doesn't exist: ${dump.name}`,
      'snapshot_not_found',
    );
  }

  return dump;
}

const load: Command = async ({ args }) => {
  const config = loadConfig(findConfigFile());
  const dumpName = args.get(0);
  const dump = await getDump(
    dumpName === undefined ? undefined : String(dumpName),
    config.storage,
  );

  const { name, connection } = await resolveConnection(config);
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
