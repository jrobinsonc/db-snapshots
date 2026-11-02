/**
 * Minimal type declarations for runtime dependencies that ship without their
 * own types. Only the parts this codebase uses are declared.
 */

declare module 'inquirer' {
  /** A single prompt shown to the user. */
  export interface Question {
    type: string;
    name: string;
    message?: string;
    default?: unknown;
    validate?: (input: string) => true | string;
    choices?: string[];
    source?: (answers: unknown, input?: string) => string[] | Promise<string[]>;
  }

  const inquirer: {
    /** Asks the given questions and resolves with the answers, keyed by question name. */
    prompt<Answers>(questions: Question[]): Promise<Answers>;
  };

  export default inquirer;
}

declare module 'yargs' {
  /** A parsed yargs argument vector. */
  export interface Arguments {
    _: (string | number)[];
    $0: string;
    [key: string]: unknown;
  }

  /** Buildable yargs instance. */
  export interface Instance {
    options(options: Record<string, unknown>): Instance;
    option(name: string, configuration: Record<string, unknown>): Instance;
    strictOptions(enabled: boolean): Instance;
    exitProcess(enabled: boolean): Instance;
    help(enabled?: boolean): Instance;
    parseSync(argv?: string[]): Arguments;
  }

  const yargs: (argv?: string[]) => Instance;

  export default yargs;
}
