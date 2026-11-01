import { describe, expect, test } from 'bun:test';

import parseCliArguments from '../../src/utils/parse-cli-arguments';

describe('utils/parseCliArguments', () => {
  test('it parses the command name and positional arguments', () => {
    const [cmd, args] = parseCliArguments(['create', 'db_name']);

    expect(cmd).toEqual('create');
    expect(args.get(0)).toEqual('db_name');
  });

  test('it returns no command when the argument list is empty', () => {
    const [cmd, args] = parseCliArguments([]);

    expect(cmd).toBeUndefined();
    expect(args).toEqual(new Map());
  });

  test('it supports boolean flags', () => {
    const options = {
      flag: { type: 'boolean' },
    };

    const [cmd, args] = parseCliArguments(['create', '--flag'], options);

    expect(cmd).toEqual('create');
    expect(args.get('flag')).toEqual(true);
  });

  test('it supports --flag=value syntax', () => {
    const options = {
      flag: { type: 'string' },
    };

    const [cmd, args] = parseCliArguments(['create', '--flag=value'], options);

    expect(cmd).toEqual('create');
    expect(args.get('flag')).toEqual('value');
  });

  test('it supports --flag value syntax', () => {
    const options = {
      flag: { type: 'string' },
    };

    const [cmd, args] = parseCliArguments(
      ['create', '--flag', 'value'],
      options,
    );

    expect(cmd).toEqual('create');
    expect(args.get('flag')).toEqual('value');
  });

  test('it supports repeatable flags', () => {
    const options = {
      tables: { type: 'string', array: true },
    };

    const [cmd, args] = parseCliArguments(
      ['create', '--tables', 'users', '--tables', 'posts'],
      options,
    );

    expect(cmd).toEqual('create');
    expect(args.get('tables')).toEqual(['users', 'posts']);
  });

  test('it supports comma-separated values for declared array options', () => {
    const options = {
      tables: { type: 'string', array: true },
    };

    const [cmd, args] = parseCliArguments(
      ['create', '--tables=users,posts'],
      options,
    );

    expect(cmd).toEqual('create');
    expect(args.get('tables')).toEqual(['users', 'posts']);
  });

  test('it supports negated boolean flags where declared', () => {
    const options = {
      'disable-keys': { type: 'boolean' },
    };

    const [cmd, args] = parseCliArguments(
      ['create', '--no-disable-keys'],
      options,
    );

    expect(cmd).toEqual('create');
    expect(args.get('disable-keys')).toEqual(false);
  });

  test('it rejects unknown flags', () => {
    expect(() => parseCliArguments(['create', '--unknown'], {})).toThrow();
  });
});
