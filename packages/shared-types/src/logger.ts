/**
 * Structured JSON logger with correlation IDs.
 * Designed for multi-tenant, per-conversation traceability.
 * Initial implementation logs to console; designed for Langfuse integration later.
 */

export interface LogContext {
  organizationId?: string;
  contactId?: string;
  conversationId?: string;
  traceId?: string;
  requestId?: string;
  [key: string]: unknown;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: { message: string; stack?: string };
}

function formatEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error,
): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
  };
  if (error) {
    entry.error = {
      message: error.message,
      stack: error.stack,
    };
  }
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    console.debug(formatEntry('debug', message, context));
  },
  info(message: string, context?: LogContext): void {
    console.info(formatEntry('info', message, context));
  },
  warn(message: string, context?: LogContext): void {
    console.warn(formatEntry('warn', message, context));
  },
  error(message: string, context?: LogContext, error?: Error): void {
    console.error(formatEntry('error', message, context, error));
  },
};
