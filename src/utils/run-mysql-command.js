import { exec } from 'node:child_process';

/**
 * Executes an SQL command using a child process and returns a Promise.
 *
 * @param {string} command - The SQL command to be executed.
 * @returns {Promise<boolean>} A Promise that resolves to true if the command is executed successfully.
 * @throws {Error} If there is an error or timeout during command execution.
 */
export default function runMySqlCommand(command) {
  return new Promise((resolve, reject) => {
    const maxExecutionTime = 30_000;
    const procTimeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout'));
    }, maxExecutionTime);

    const proc = exec(command, (error, _, stderr) => {
      if (stderr) {
        const matches = stderr.match(/ERROR (\d+) \((\w+)\): (.+)/);
        const matchesCount = 4;

        if (matches && matches.length === matchesCount) {
          const [, errorCode, errorType, errorMessage] = matches;

          reject(
            new Error(`ERROR: ${errorCode} (${errorType}) ${errorMessage}`),
          );

          return;
        }
      }

      if (error) {
        reject(error);

        return;
      }

      clearTimeout(procTimeout);
      resolve(true);
    });
  });
}
