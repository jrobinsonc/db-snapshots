import Configstore from 'configstore';
import getApp from './utils/get-app';
import { ask } from './utils/prompt';

/** The settings used to connect to the app's database. */
export interface Connection {
  host: string;
  user: string;
  password: string;
  database: string;
  port: string | number;
}

const config = new Configstore('db');

export default {
  async getAppConnection(): Promise<Connection> {
    const key = `${getApp()}.connection`;
    // The store only ever holds values written by this function.
    const connection = config.get(key) as Connection | undefined;

    if (connection !== undefined) {
      return connection;
    }

    const answers = await ask<Connection>([
      {
        type: 'input',
        name: 'host',
        default: '127.0.0.1',
        validate: (input) => {
          return /^((?:\d{1,3}\.){3}\d{1,3}|\w+)$/.test(input)
            ? true
            : 'Invalid host.';
        },
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
        validate: (input) => {
          return /^\w+$/.test(input) ? true : 'Invalid database name.';
        },
      },
      {
        type: 'input',
        name: 'port',
        default: 3306,
        validate: (input) => {
          return /^\d+$/i.test(input) ? true : 'Invalid port number.';
        },
      },
    ]);

    config.set(key, answers);

    return answers;
  },
};
