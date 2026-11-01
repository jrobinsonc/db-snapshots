/**
 * Minimal type declarations for runtime dependencies that ship without their
 * own types. Only the parts this codebase uses are declared.
 */

declare module 'clui' {
  /** A terminal spinner shown while a long-running task is in progress. */
  class Spinner {
    constructor(message: string);
    start(): void;
    stop(): void;
  }

  const clui: { Spinner: typeof Spinner };

  export default clui;
}

declare module 'configstore' {
  /** A persistent key-value store kept in the user's config directory. */
  export default class Configstore {
    constructor(id: string);
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  }
}

declare module 'inquirer' {
  /** A single prompt shown to the user. */
  export interface Question {
    type: string;
    name: string;
    message?: string;
    default?: unknown;
    validate?: (input: string) => true | string;
    source?: (
      answers: unknown,
      input?: string,
    ) => string[] | Promise<string[]>;
  }

  const inquirer: {
    /** Asks the given questions and resolves with the answers, keyed by question name. */
    prompt<Answers>(questions: Question[]): Promise<Answers>;
    /** Registers a custom prompt type. */
    registerPrompt(name: string, prompt: unknown): void;
  };

  export default inquirer;
}

declare module 'inquirer-autocomplete-prompt' {
  /** The autocomplete prompt type, registered through `inquirer.registerPrompt`. */
  const autocompletePrompt: unknown;

  export default autocompletePrompt;
}

declare module 'minimist' {
  /** The parsed arguments: positionals under `_`, flags under their own names. */
  export interface ParsedArgs {
    _: (string | number)[];
    [flag: string]: unknown;
  }

  export default function minimist(args: string[]): ParsedArgs;
}
