import chalk from 'chalk';

const { log } = console;

export default {
  error: (text) => log(chalk.red(text)),
  success: (text) => log(chalk.green(text)),
  log: (text) => log(chalk.whiteBright(`${text}`)),
  warn: (text) => log(chalk.yellow(text)),
};
