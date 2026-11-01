import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Root dir */
export const ROOT_DIR = join(fileURLToPath(import.meta.url), '..', '..');

/** Dump dir */
export const DUMP_DIR = join(ROOT_DIR, 'dump');
