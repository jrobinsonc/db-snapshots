import parseCliArguments from '../../src/utils/parse-cli-arguments.js';

describe('utils/parseCliArguments', () => {
  test('it should parse named arguments and boolean flags into a map object', () => {
    const cliArguments = [
      'create',
      'db_name',
      '-ab',
      '-c',
      '--disable-keys',
      '--tables=users,posts',
    ];
    const expectedMap = new Map([
      ['a', true],
      ['b', true],
      ['c', true],
      ['disable-keys', true],
      ['tables', 'users,posts'],
      [0, 'db_name'],
    ]);
    const [cmd, cmdArguments] = parseCliArguments(cliArguments);

    expect(cmd).toEqual('create');
    expect(cmdArguments).toEqual(expectedMap);
  });

  test('it should return an empty map if no arguments provided', () => {
    const cliArguments = ['create'];
    const [cmd, cmdArguments] = parseCliArguments(cliArguments);

    expect(cmd).toEqual('create');
    expect(cmdArguments).toEqual(new Map());
  });

  // test('it should handle null and undefined arguments', () => {
  //   expect(parseCliArguments(null, undefined)).toEqual(new Map());
  // });

  // test('it should overwrite boolean flags with named arguments', () => {
  //   const namedArgs = { flag1: 'value1' };
  //   const booleanArgs = ['flag1'];
  //   const expectedMap = new Map([['flag1', 'value1']]);

  //   expect(parseCliArguments(namedArgs, booleanArgs)).toEqual(expectedMap);
  // });
});
