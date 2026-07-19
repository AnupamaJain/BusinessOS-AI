import { describe, it, expect } from 'vitest';
import {
  AppError,
  TenantAccessError,
  ValidationError,
  NotFoundError,
  IdempotencyConflictError,
  PolicyViolationError,
  ConsentRequiredError,
} from '../errors';

describe('AppError', () => {
  it('creates error with code and status', () => {
    const err = new AppError('test error', 'TEST_CODE', 400);
    expect(err.message).toBe('test error');
    expect(err.code).toBe('TEST_CODE');
    expect(err.statusCode).toBe(400);
    expect(err.isOperational).toBe(true);
  });

  it('returns user-safe representation', () => {
    const err = new AppError('visible error', 'ERR', 400, true);
    expect(err.toUserSafe()).toEqual({
      error: 'visible error',
      code: 'ERR',
    });
  });

  it('hides non-operational error messages', () => {
    const err = new AppError('internal detail', 'ERR', 500, false);
    expect(err.toUserSafe().error).toBe('An internal error occurred.');
  });
});

describe('TenantAccessError', () => {
  it('defaults to 403 with appropriate code', () => {
    const err = new TenantAccessError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('TENANT_ACCESS_DENIED');
  });
});

describe('ValidationError', () => {
  it('defaults to 400', () => {
    const err = new ValidationError('invalid input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
  });
});

describe('NotFoundError', () => {
  it('defaults to 404', () => {
    const err = new NotFoundError('Lead', 'abc-123');
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('Lead');
    expect(err.message).toContain('abc-123');
  });

  it('works without id', () => {
    const err = new NotFoundError('Contact');
    expect(err.message).toBe('Contact not found.');
  });
});

describe('IdempotencyConflictError', () => {
  it('defaults to 409', () => {
    const err = new IdempotencyConflictError('key-123');
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('key-123');
  });
});

describe('PolicyViolationError', () => {
  it('defaults to 403', () => {
    const err = new PolicyViolationError('cannot provide medical advice');
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('POLICY_VIOLATION');
  });
});

describe('ConsentRequiredError', () => {
  it('defaults to 403', () => {
    const err = new ConsentRequiredError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('CONSENT_REQUIRED');
  });
});
