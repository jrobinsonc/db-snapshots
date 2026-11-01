import fs from 'node:fs';
import { DUMP_DIR } from '../constants';

/**
 * Reads the dump directory and returns the list of files.
 *
 * @returns An array of file names without the .sql extension.
 */
export default async function getDumpFiles(): Promise<string[]> {
  return fs.readdirSync(DUMP_DIR).reduce<string[]>((list, fileName) => {
    if (!fileName.endsWith('.sql')) {
      return list;
    }

    return [...list, fileName.replace('.sql', '')];
  }, []);
}
