import type { RegisteredCommand } from '../commands';

/**
 * Renders the top-level help listing every command.
 *
 * @param commands - The registered commands keyed by name.
 * @returns The help text.
 */
export function renderGeneralHelp(
  commands: Readonly<Record<string, RegisteredCommand>>,
): string {
  const entries = Object.entries(commands);
  const width = Math.max(...entries.map(([name]) => name.length));
  const rows = entries.map(
    ([name, { description }]) => `  ${name.padEnd(width)}  ${description}`,
  );

  return [
    'Usage: dbs <command> [options]',
    '',
    'Commands:',
    ...rows,
    '',
    'Options:',
    '  --help, -h  Show help (also: dbs help <command>)',
    '  --version   Show the version',
    '  --no-color  Disable colored output (also: NO_COLOR)',
  ].join('\n');
}

/**
 * Renders the help for a single command.
 *
 * @param name - The command name.
 * @param command - The registered command.
 * @returns The help text.
 */
export function renderCommandHelp(
  name: string,
  command: RegisteredCommand,
): string {
  const lines = [
    `Usage: dbs ${name} ${command.usage}`.trimEnd(),
    '',
    command.description,
  ];
  const options = Object.entries(command.options);

  if (options.length > 0) {
    lines.push('', 'Options:');

    for (const [flag, definition] of options) {
      const text = definition['description'];

      lines.push(`  --${flag}${typeof text === 'string' ? `  ${text}` : ''}`);
    }
  }

  lines.push('', '  --help, -h  Show this help');

  return lines.join('\n');
}
