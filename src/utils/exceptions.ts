export class UserError extends Error {
  constructor(message: string) {
    super(message);

    Error.captureStackTrace(this, this.constructor);

    this.name = 'UserError';
  }
}

/**
 * Raises an error
 *
 * @param error - Error instance
 * @returns never; it always throws the error
 */
export function raise(error: UserError): never {
  throw error;
}
