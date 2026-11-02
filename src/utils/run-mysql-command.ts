import { exec } from 'node:child_process';
import type { ConnectionConfig } from './load-config';

/**
 * Builds the client arguments for a Connection: its flags followed by the
 * database. Unset fields are left out so the client's own defaults apply.
 *
 * @param connection - The Connection to connect to.
 * @returns The arguments, space separated.
 */
export function clientArgs(connection: ConnectionConfig): string {
  const args = [
    connection.host === undefined ? undefined : `-h ${connection.host}`,
    connection.port === undefined ? undefined : `-P ${connection.port}`,
    connection.user === undefined ? undefined : `-u ${connection.user}`,
    connection.password === undefined ? undefined : `-p${connection.password}`,
    connection.database,
  ];

  return args.filter((arg) => arg !== undefined).join(' ');
}

/**
 * Executes an SQL command using a child process and returns a Promise.
 *
 * @param command - The SQL command to be executed.
 * @returns A Promise that resolves to true if the command is executed successfully.
 * @throws If there is an error or timeout during command execution.
 */
export default function runMySqlCommand(command: string): Promise<boolean> {
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
