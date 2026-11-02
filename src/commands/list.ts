import { findConfigFile } from '../utils/find-config-file';
import { loadConfig } from '../utils/load-config';
import { listSnapshots } from '../utils/snapshot-repository';
import type { Command } from '../types';

const list: Command = async () => {
  const { storage } = loadConfig(findConfigFile());

  return { kind: 'list', snapshots: await listSnapshots(storage) };
};

export default list;

export const options = {};
