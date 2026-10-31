/**
 * @returns {string} The normalized current working directory.
 */
export default function getApp() {
  return process.cwd().replaceAll(/[^\da-z]+/gi, '_');
}
