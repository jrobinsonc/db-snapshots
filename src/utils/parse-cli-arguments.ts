import minimist from 'minimist';

/** CLI arguments keyed by flag name, or by index for positional arguments. */
export type CliArguments = Map<string | number, unknown>;

/**
 * Parses the CLI arguments into a Map object.
 *
 * @param cliArguments - The raw CLI arguments.
 * @returns A tuple with the command and a Map with all the arguments.
 */
export default function parseCliArguments(
  cliArguments: string[],
): [string | number | undefined, CliArguments] {
  const {
    _: [cmd, ...booleanArguments],
    ...namedArguments
  } = minimist(cliArguments);

  const map: CliArguments = new Map();

  for (const [key, value] of Object.entries(namedArguments)) {
    map.set(key, value);
  }

  for (const [index, value] of booleanArguments.entries()) {
    map.set(index, value);
  }

  return [cmd, map];
}
