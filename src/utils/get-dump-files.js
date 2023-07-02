import fs from 'node:fs';

import { DUMP_DIR } from '../constants.js';

/**
 *
 */
export default async function getDumpFiles() {
  return fs.readdirSync(DUMP_DIR).reduce((list, fileName) => {
    if (!fileName.endsWith('.sql')) {
      return list;
    }

    return [...list, fileName.replace('.sql', '')];
  }, []);
}
