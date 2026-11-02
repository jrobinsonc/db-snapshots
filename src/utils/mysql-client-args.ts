import type { ConnectionConfig } from './load-config';

/**
 * Builds the client arguments for a Connection: its flags followed by the
 * database. Unset fields are left out so the client's own defaults apply.
 *
 * @param connection - The Connection to connect to.
 * @returns The arguments, one per element.
 */
export function clientArgs(connection: ConnectionConfig): string[] {
  const args = [
    connection.host === undefined ? undefined : `--host=${connection.host}`,
    connection.port === undefined ? undefined : `--port=${connection.port}`,
    connection.user === undefined ? undefined : `--user=${connection.user}`,
    connection.password === undefined
      ? undefined
      : `--password=${connection.password}`,
    connection.database,
  ];

  return args.filter((arg) => arg !== undefined);
}
