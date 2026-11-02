import type { ConnectionConfig } from '../utils/load-config';

/** The Driver a Connection declares. */
export type DriverName = ConnectionConfig['driver'];

/** How a client process authenticates. Never carries a password on argv. */
export interface ClientCredentials {
  /** Arguments placed right after the binary. */
  args: string[];
  /** Environment variables added for the client process. */
  env: Record<string, string>;
}

/** What `dump` writes and how. */
export interface DumpOptions {
  /** Consumes the dump streamed on the client's stdout. */
  stdout: (output: ReadableStream<Uint8Array>) => Promise<unknown>;
  /** Literal table names to dump. Every table is dumped when empty or unset. */
  tables?: string[];
  /** Literal table names to leave out. Ignored when `tables` is set. */
  exclude?: string[];
  /** Flags appended after the default dump flags. */
  extraOptions?: string[];
}

/** What `load` streams into the database. */
export interface LoadOptions {
  /** SQL streamed into the client's stdin. A `Bun.file()` streams that file. */
  input: Blob | ReadableStream<Uint8Array>;
  /** Flags appended to the load command. */
  extraOptions?: string[];
}

/**
 * Everything the tool needs from one Driver. Snapshots are created
 * and loaded only through the Driver's client binaries (ADR-0001).
 */
export interface Driver {
  readonly name: DriverName;
  /** Client binaries the Driver runs, checked by the preflight. */
  readonly binaries: { readonly dump: string; readonly load: string };
  /**
   * @returns The flags every dump starts with. User flags come after them.
   */
  defaultDumpFlags(): Promise<string[]>;
  /**
   * Prepares the credentials for a client invocation and cleans them up
   * afterwards, whether `use` succeeds or fails.
   *
   * @param connection - The Connection to authenticate against.
   * @param use - Runs the client with the credentials.
   * @returns What `use` resolves with.
   */
  withCredentials<T>(
    connection: ConnectionConfig,
    use: (credentials: ClientCredentials) => Promise<T>,
  ): Promise<T>;
  /**
   * Lists the dumpable tables of the Connection's database, for glob expansion.
   *
   * @param connection - The Connection to inspect.
   * @returns The table names, sorted.
   */
  listTables(connection: ConnectionConfig): Promise<string[]>;
  /**
   * Generates the SQL that empties the Connection's database before a load.
   *
   * @param connection - The Connection to inspect.
   * @returns The statements, or an empty string when there is nothing to drop.
   */
  dropAllStatements(connection: ConnectionConfig): Promise<string>;
  /**
   * Streams a dump of the Connection's database.
   *
   * @param connection - The Connection to dump.
   * @param options - Where the dump goes and what it contains.
   */
  dump(connection: ConnectionConfig, options: DumpOptions): Promise<void>;
  /**
   * Streams SQL into the Connection's database, stopping at the first error.
   *
   * @param connection - The Connection to load into.
   * @param options - The SQL and extra flags.
   */
  load(connection: ConnectionConfig, options: LoadOptions): Promise<void>;
}
