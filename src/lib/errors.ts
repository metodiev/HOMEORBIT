export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super("unauthorized", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super("forbidden", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super("not_found", message, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("validation_error", message, 400, details);
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
