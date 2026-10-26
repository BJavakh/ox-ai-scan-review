import type { ApiErrorCode } from '@ox-scan/shared';

/** An error that maps directly onto the public error envelope. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found.');
