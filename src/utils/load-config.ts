import fs from 'node:fs';
import path from 'node:path';

import schema from '../../db-snapshots.schema.json';
import { UserError } from './exceptions';

/** The settings that identify one database to snapshot or load into. */
export interface ConnectionConfig {
  driver: 'mysql';
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  database?: string;
}

/** A validated project config, with defaults applied and paths resolved. */
export interface ProjectConfig {
  default_connection?: string;
  /** Absolute path of the Snapshot Storage. */
  storage: string;
  connections: Record<string, ConnectionConfig>;
}

/** The subset of JSON Schema keywords the shipped schema uses. */
interface Schema {
  type?: string | string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  enum?: unknown[];
  required?: string[];
  minProperties?: number;
}

const DEFAULT_STORAGE = 'snapshots';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isRecord(value);
    case 'integer':
      return Number.isInteger(value);
    default:
      return typeof value === type;
  }
}

/**
 * Checks `value` against `rule`.
 *
 * @param fieldPath - Dotted path of `value` within the config; '' for the root
 * @returns the first violation as a message, or undefined when valid
 */
function findViolation(
  rule: Schema,
  value: unknown,
  fieldPath: string,
): string | undefined {
  const name = fieldPath === '' ? 'the config' : `"${fieldPath}"`;

  if (rule.type !== undefined) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];

    if (!types.some((type) => hasType(value, type))) {
      return `${name} must be of type ${types.join(' or ')}`;
    }
  }

  if (rule.enum !== undefined && !rule.enum.includes(value)) {
    const options = rule.enum.map((option) => JSON.stringify(option));

    return `${name} must be one of ${options.join(', ')}`;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const missing = rule.required?.find((key) => !(key in value));

  if (missing !== undefined) {
    return `${name} is missing the required field "${missing}"`;
  }

  if (
    rule.minProperties !== undefined &&
    Object.keys(value).length < rule.minProperties
  ) {
    return `${name} needs at least ${rule.minProperties} entry`;
  }

  for (const [key, child] of Object.entries(value)) {
    const childRule = rule.properties?.[key] ?? rule.additionalProperties;
    const childPath = fieldPath === '' ? key : `${fieldPath}.${key}`;

    if (childRule === false) {
      return `unknown field "${childPath}"`;
    }

    if (typeof childRule === 'object') {
      const childViolation = findViolation(childRule, child, childPath);

      if (childViolation !== undefined) {
        return childViolation;
      }
    }
  }

  return undefined;
}

/**
 * Reads and validates a `.db-snapshots.json` file against the shipped schema.
 *
 * @param configPath - Path of the config file
 * @returns the config with defaults applied and `storage` made absolute
 * @throws {UserError} with code `config_invalid` when the file breaks the schema
 */
export function loadConfig(configPath: string): ProjectConfig {
  const invalidConfig = (reason: string): UserError =>
    new UserError(`Invalid config ${configPath}: ${reason}.`, 'config_invalid');

  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    throw invalidConfig(error.message);
  }

  const schemaViolation = findViolation(schema as Schema, parsed, '');

  if (schemaViolation !== undefined) {
    throw invalidConfig(schemaViolation);
  }

  // The schema check above guarantees this shape.
  const config = parsed as Omit<ProjectConfig, 'storage'> & {
    storage?: string;
  };

  return {
    ...config,
    storage: path.resolve(
      path.dirname(configPath),
      config.storage ?? DEFAULT_STORAGE,
    ),
  };
}
