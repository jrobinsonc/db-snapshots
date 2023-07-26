import fs from 'node:fs';
import { DUMP_DIR } from '../constants.js';

/**
 * Reads the dump directory and returns the list of files.
 *
 * @returns {string[]} An array of file names without the .sql extension.
 */
export default async function getDumpFiles() {
  return fs.readdirSync(DUMP_DIR).reduce((list, fileName) => {
    if (!fileName.endsWith('.sql')) {
      return list;
    }

    return [...list, fileName.replace('.sql', '')];
  }, []);
}
