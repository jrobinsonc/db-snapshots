import { describe, expect, test } from 'bun:test';
import { createPrompter } from '../../src/utils/prompt';
import { UserError } from '../../src/utils/exceptions';
import type { Question } from 'inquirer';

function setup(interactive: boolean, answers: Record<string, unknown> = {}) {
  const asked: Question[][] = [];
  const prompter = createPrompter({
    isInteractive: () => interactive,
    run: async (questions) => {
      asked.push(questions);

      return answers;
    },
  });

  return { prompter, asked };
}

describe('ask', () => {
  test('interactive: forwards the questions and returns the answers', async () => {
    const { prompter, asked } = setup(true, { host: 'db' });

    const result = await prompter.ask<{ host: string }>([
      { type: 'input', name: 'host' },
    ]);

    expect(result).toEqual({ host: 'db' });
    expect(asked).toHaveLength(1);
  });

  test('noninteractive: fails with a user error naming the input', async () => {
    const { prompter, asked } = setup(false);
    const error = await prompter
      .ask([
        { type: 'input', name: 'host' },
        { type: 'input', name: 'dumpName', message: 'the dump name' },
      ])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toBe('input_required');
    expect((error as UserError).message).toContain('host');
    expect((error as UserError).message).toContain('the dump name');
    expect(asked).toHaveLength(0);
  });
});

describe('confirm', () => {
  test('defaults to No', async () => {
    const { prompter, asked } = setup(true, { confirmed: false });

    expect(await prompter.confirm('Overwrite?')).toBe(false);
    expect(asked[0]?.[0]?.default).toBe(false);
  });

  test('interactive: returns the answer', async () => {
    const { prompter } = setup(true, { confirmed: true });

    expect(await prompter.confirm('Overwrite?')).toBe(true);
  });

  test('noninteractive: fails with a user error naming the confirmation', async () => {
    const { prompter, asked } = setup(false);
    const error = await prompter
      .confirm('Overwrite?')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toBe('input_required');
    expect((error as UserError).message).toContain('Overwrite?');
    expect(asked).toHaveLength(0);
  });
});
