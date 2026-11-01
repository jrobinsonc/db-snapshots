import yargs from 'yargs';

/** CLI arguments keyed by flag name, or by index for positional arguments. */
export type CliArguments = Map<string | number, unknown>;

/** A yargs option declaration supplied by a command module. */
export type CliOptionDefinitions = Record<string, Record<string, unknown>>;

/**
 * Splits comma-separated values for array options that do not declare their own
 * coercion logic.
 */
function splitCommaSeparatedValues(
  optionDefinitions: CliOptionDefinitions,
  parsed: Record<string, unknown>,
): void {
  for (const [key, definition] of Object.entries(optionDefinitions)) {
    const isArrayOption =
      definition?.['type'] === 'array' || definition?.['array'] === true;
    const hasCustomCoercion = typeof definition?.['coerce'] === 'function';

    if (!isArrayOption || hasCustomCoercion) {
      continue;
    }

    const value = parsed[key];

    if (typeof value === 'string') {
      parsed[key] = value.split(',');
    } else if (Array.isArray(value)) {
      parsed[key] = value.flatMap((item) =>
        typeof item === 'string' ? item.split(',') : [item],
      );
    }
  }
}

/**
 * Parses the CLI arguments with yargs.
 *
 * @param cliArguments - The raw CLI arguments.
 * @param optionDefinitions - The yargs option declarations for the command.
 * @returns A tuple with the command name and a map with all arguments.
 */
export default function parseCliArguments(
  cliArguments: string[],
  optionDefinitions: CliOptionDefinitions = {},
): [string | number | undefined, CliArguments] {
  const parser = yargs(cliArguments) as any;

  if (Object.keys(optionDefinitions).length > 0) {
    parser.options(optionDefinitions);
  }

  parser.strictOptions(true);
  parser.exitProcess(false);

  const parsed = parser.parseSync() as {
    _: Array<string | number>;
    $0?: string;
    [key: string]: unknown;
  };

  splitCommaSeparatedValues(optionDefinitions, parsed);

  const positionals = Array.isArray(parsed._) ? parsed._.slice(1) : [];

  const map: CliArguments = new Map();

  for (const [index, value] of positionals.entries()) {
    map.set(index, value);
  }

  const optionKeys =
    Object.keys(optionDefinitions).length > 0
      ? Object.keys(optionDefinitions)
      : Object.keys(parsed).filter((key) => key !== '_' && key !== '$0');

  for (const key of optionKeys) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      map.set(key, parsed[key]);
    }
  }

  const command =
    Array.isArray(parsed._) && parsed._.length > 0 ? parsed._[0] : undefined;

  return [command, map];
}
