/** The stable set of error codes a user error may carry. */
export const USER_ERROR_CODES = [
  'usage',
  'input_required',
  'config_not_found',
  'connection_not_found',
  'snapshot_not_found',
  'ambiguous_snapshot',
  'snapshot_exists',
  'driver_mismatch',
  'protected_connection',
  'missing_binary',
  'client_failed',
] as const;

export type UserErrorCode = (typeof USER_ERROR_CODES)[number];

/** An expected failure caused by the user's input or environment. */
export class UserError extends Error {
  readonly code: UserErrorCode;

  constructor(message: string, code: UserErrorCode) {
    super(message);

    Error.captureStackTrace(this, this.constructor);

    this.name = 'UserError';
    this.code = code;
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
