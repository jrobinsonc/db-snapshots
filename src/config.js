import Configstore from 'configstore';
import inquirer from 'inquirer';

import getApp from './utils/get-app.js';

const config = new Configstore('db');

export default {
  async getAppConnection() {
    const key = `${getApp()}.connection`;
    const connection = config.get(key);

    if (connection !== undefined) {
      return connection;
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        default: '127.0.0.1',
        validate: (input) =>
          /^((?:\d{1,3}\.){3}\d{1,3}|\w+)$/.test(input)
            ? true
            : 'Invalid host.',
      },
      {
        type: 'input',
        name: 'user',
        default: 'root',
      },
      {
        type: 'password',
        name: 'password',
        default: 'root',
      },
      {
        type: 'input',
        name: 'database',
        validate: (input) =>
          /^\w+$/.test(input) ? true : 'Invalid database name.',
      },
      {
        type: 'input',
        name: 'port',
        default: 3306,
        validate: (input) =>
          /^\d+$/i.test(input) ? true : 'Invalid port number.',
      },
    ]);

    config.set(key, answers);

    return answers;
  },
};
