import { mock } from 'bun:test';

/** Replaces the command registry with one command that throws or succeeds. */
mock.module('../src/commands', () => ({
  listCommands: () => ({}),
  getCommand: () => ({
    options: {},
    description: '',
    usage: '',
    run: () => {
      if (process.env['FIXTURE_COMMAND'] === 'throw') {
        throw new Error('boom from test');
      }
    },
  }),
}));
