/**
 * Typed application errors.
 * Never leak internal stack traces to users.
 */

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string,
    statusCode = 500,
    isOperational = true,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /** User-safe error message (never includes stack trace) */
  toUserSafe(): { error: string; code: string } {
    return {
      error: this.isOperational ? this.message : 'An internal error occurred.',
      code: this.code,
    };
  }
}

export class TenantAccessError extends AppError {
  constructor(message = 'Access denied for this organization.') {
    super(message, 'TENANT_ACCESS_DENIED', 403);
    this.name = 'TenantAccessError';
    Object.setPrototypeOf(this, TenantAccessError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(
      id ? `${entity} with id ${id} not found.` : `${entity} not found.`,
      'NOT_FOUND',
      404,
    );
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(key: string) {
    super(
      `Duplicate operation detected for key: ${key}`,
      'IDEMPOTENCY_CONFLICT',
      409,
    );
    this.name = 'IdempotencyConflictError';
    Object.setPrototypeOf(this, IdempotencyConflictError.prototype);
  }
}

export class PolicyViolationError extends AppError {
  constructor(message: string) {
    super(message, 'POLICY_VIOLATION', 403);
    this.name = 'PolicyViolationError';
    Object.setPrototypeOf(this, PolicyViolationError.prototype);
  }
}

export class ConsentRequiredError extends AppError {
  constructor(message = 'Consent is required for this operation.') {
    super(message, 'CONSENT_REQUIRED', 403);
    this.name = 'ConsentRequiredError';
    Object.setPrototypeOf(this, ConsentRequiredError.prototype);
  }
}
