import type { CliArguments } from './utils/parse-cli-arguments';

/** What every command receives when it runs. */
export interface CommandContext {
  /** The command's arguments, keyed by flag name or positional index. */
  args: CliArguments;
}

/** A command module's default export. */
export type Command = (context: CommandContext) => Promise<void>;
