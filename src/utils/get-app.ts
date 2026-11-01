/**
 * @returns The normalized current working directory.
 */
export default function getApp(): string {
  return process.cwd().replaceAll(/[^\da-z]+/gi, '_');
}
