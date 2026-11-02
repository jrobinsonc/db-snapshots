import { mysqlDriver } from './mysql';
import type { Driver, DriverName } from './types';

const drivers: Readonly<Record<DriverName, Driver>> = {
  mysql: mysqlDriver,
};

/**
 * Looks up the Driver a Connection declares.
 *
 * @param name - The Connection's `driver`.
 * @returns The Driver.
 */
export function getDriver(name: DriverName): Driver {
  return drivers[name];
}

export type { Driver, DriverName } from './types';
