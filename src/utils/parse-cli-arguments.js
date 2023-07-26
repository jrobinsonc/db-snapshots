import minimist from 'minimist';

/**
 * Parses the CLI arguments into a Map object.
 *
 * @param {object} cliArguments - An object containing the CLI arguments.
 * @returns {[string, Map]} A tuple with the command and a Map with all the arguments.
 */
export default function parseCliArguments(cliArguments) {
  const {
    _: [cmd, ...booleanArguments],
    ...namedArguments
  } = minimist(cliArguments);

  const map = new Map();

  for (const [key, value] of Object.entries(namedArguments)) {
    map.set(key, value);
  }

  for (const [index, value] of booleanArguments.entries()) {
    map.set(index, value);
  }

  return [cmd, map];
}
