import type { CliArguments } from './utils/parse-cli-arguments';

/** What every command receives when it runs. */
export interface CommandContext {
  /** The command's arguments, keyed by flag name or positional index. */
  args: CliArguments;
}

/** A snapshot file as reported to the user. */
export interface Snapshot {
  name: string;
  file: string;
  /** Connection recorded in the header; null for headerless files. */
  connection: string | null;
  /** Driver recorded in the header; null for headerless files. */
  driver: string | null;
  /** Creation time, ISO-8601 UTC. */
  created_at: string;
  size_bytes: number;
  compressed: boolean;
}

/** The outcome of `create`. */
export interface CreateResult {
  kind: 'create';
  snapshot: Snapshot;
  overwritten: boolean;
}

/** The outcome of `load`. */
export interface LoadResult {
  kind: 'load';
  snapshot: Snapshot;
  connection: string;
  dropped: boolean;
  duration_ms: number;
}

/** What a command returns for the output layer to render. */
export type CommandResult = CreateResult | LoadResult;

/** A command module's default export. Resolves to undefined when there is nothing to report. */
export type Command = (
  context: CommandContext,
) => Promise<CommandResult | undefined>;
