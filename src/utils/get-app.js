/**
 *
 */
export default function getApp() {
  return process.cwd().replaceAll(/[^\da-z]+/gi, '_');
}
