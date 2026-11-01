import chalk from 'chalk';

const { log } = console;

export default {
  error: (text: string) => log(chalk.red(text)),
  success: (text: string) => log(chalk.green(text)),
  log: (text: string) => log(chalk.whiteBright(`${text}`)),
  warn: (text: string) => log(chalk.yellow(text)),
};
