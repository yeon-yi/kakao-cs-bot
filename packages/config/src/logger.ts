import { AsyncLocalStorage } from 'async_hooks';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// ===================== Request Context (AsyncLocalStorage) =====================
const requestStore = new AsyncLocalStorage<{ requestId: string }>();

export function setRequestContext(requestId: string): void {
  requestStore.enterWith({ requestId });
}

export function getRequestId(): string | undefined {
  return requestStore.getStore()?.requestId;
}

// ===================== Logger =====================
class Logger {
  private level: LogLevel;
  private context: string;

  constructor(context: string, level?: LogLevel) {
    this.context = context;
    this.level = level || (process.env.LOG_LEVEL as LogLevel) || 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const requestId = getRequestId();
    const base: Record<string, unknown> = { timestamp, level, context: this.context, message };
    if (requestId) base.requestId = requestId;
    if (meta) Object.assign(base, meta);
    return JSON.stringify(base);
  }

  debug(message: string, meta?: Record<string, unknown>) {
    if (this.shouldLog('debug')) console.debug(this.format('debug', message, meta));
  }
  info(message: string, meta?: Record<string, unknown>) {
    if (this.shouldLog('info')) console.info(this.format('info', message, meta));
  }
  warn(message: string, meta?: Record<string, unknown>) {
    if (this.shouldLog('warn')) console.warn(this.format('warn', message, meta));
  }
  error(message: string, meta?: Record<string, unknown>) {
    if (this.shouldLog('error')) console.error(this.format('error', message, meta));
  }

  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`, this.level);
  }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}

export { Logger };
