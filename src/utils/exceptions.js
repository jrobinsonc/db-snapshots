export class UserError extends Error {
  constructor(message) {
    super(message);

    Error.captureStackTrace(this, this.constructor);

    this.name = 'UserError';
  }
}

/**
 * Raises an error
 *
 * @param {UserError} error - Error instance
 * @returns {never} throws error
 */
export function raise(error) {
  throw error;
}
