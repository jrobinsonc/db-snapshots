import inquirer from 'inquirer';
import type { Question } from 'inquirer';
import { UserError } from './exceptions';

interface PrompterDeps {
  /** Whether a human can answer prompts. */
  isInteractive: () => boolean;
  /** Shows the questions and resolves with the answers. */
  run: (questions: Question[]) => Promise<Record<string, unknown>>;
}

/**
 * Builds the prompt helper. Every prompt in the tool goes through it, so
 * automation (non-TTY stdin) never hangs waiting for input.
 *
 * @param deps - Overridable collaborators, for tests.
 * @returns The `ask` and `confirm` functions.
 */
export function createPrompter(deps: PrompterDeps) {
  /**
   * Asks questions, or fails with a user error when no one can answer.
   *
   * @param questions - The questions to ask.
   * @returns The answers, keyed by question name.
   */
  async function ask<Answers>(questions: Question[]): Promise<Answers> {
    if (!deps.isInteractive()) {
      const missing = questions.map((q) => q.message ?? q.name).join(', ');

      throw new UserError(
        `Input required but stdin is not a terminal: ${missing}`,
        'input_required',
      );
    }

    return (await deps.run(questions)) as Answers;
  }

  /**
   * Asks a yes/no safety confirmation. Defaults to No.
   *
   * @param message - The question to show.
   * @returns True only when the user explicitly confirmed.
   */
  async function confirm(message: string): Promise<boolean> {
    const { confirmed } = await ask<{ confirmed: boolean }>([
      { type: 'confirm', name: 'confirmed', message, default: false },
    ]);

    return confirmed;
  }

  return { ask, confirm };
}

const prompter = createPrompter({
  isInteractive: () => process.stdin.isTTY === true,
  run: (questions) => inquirer.prompt<Record<string, unknown>>(questions),
});

export const { ask, confirm } = prompter;
