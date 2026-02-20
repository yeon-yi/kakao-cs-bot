import { z } from 'zod';
import { config } from 'dotenv';
import { resolve } from 'path';

// .env 파일 로드 (루트 디렉토리에서 찾기)
function findEnvFile() {
  let dir = process.cwd();
  // 모노레포 루트의 .env를 찾을 때까지 상위로 이동
  for (let i = 0; i < 5; i++) {
    config({ path: resolve(dir, '.env') });
    dir = resolve(dir, '..');
  }
}
findEnvFile();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  API_URL: z.string().url().default('http://localhost:3000'),
  API_PORT: z.coerce.number().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),

  DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1),

  AI_DEFAULT_MODEL: z.string().default('gemini-flash'),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  AI_MAX_TOKENS: z.coerce.number().default(1000),
  USE_PRO_FOR_STAFF: z.string().transform(v => v === 'true').default('true'),

  KAKAO_DEVICE_ID: z.string().default(''),
  KAKAO_DEVICE_MODEL: z.string().default('SM-A536N'),
  KAKAO_OS_VERSION: z.string().default('13'),
  KAKAO_OAUTH_TOKEN: z.string().optional(),

  JWT_SECRET: z.string().min(32).default('dev-secret-key-must-be-at-least-32-chars'),
  ENCRYPTION_KEY: z.string().default('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='),

  NEXTAUTH_URL: z.string().default('http://localhost:3001'),
  NEXTAUTH_SECRET: z.string().default('dev-nextauth-secret'),

  OPERATION_START_TIME: z.string().default('09:50'),
  OPERATION_END_TIME: z.string().default('18:30'),
  OPERATION_TIMEZONE: z.string().default('Asia/Seoul'),
  MIN_RESPONSE_DELAY: z.coerce.number().default(2000),
  MAX_RESPONSE_DELAY: z.coerce.number().default(8000),

  ADMIN_PASSWORD: z.string().min(4).default('admin123!'),
  ADMIN_AUTO_LOGIN_KEY: z.string().min(4).default('csbot2026!admin'),

  WEBHOOK_SECRET: z.string().default('csbot-webhook-2026!secret'),

  DD_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function loadEnv(): Env {
  if (_env) return _env;

  try {
    _env = envSchema.parse(process.env);
    return _env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Environment validation failed:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
    }
    process.exit(1);
  }
}

export function getEnv(): Env {
  if (!_env) return loadEnv();
  return _env;
}

export function maskSensitive(env: Env): Record<string, string> {
  const masked: Record<string, string> = {};
  const sensitiveKeys = ['DATABASE_URL','GEMINI_API_KEY','ANTHROPIC_API_KEY','OPENAI_API_KEY','JWT_SECRET','ENCRYPTION_KEY','DD_API_KEY','NEXTAUTH_SECRET'];

  for (const [key, value] of Object.entries(env)) {
    if (sensitiveKeys.includes(key) && typeof value === 'string' && value.length > 10) {
      masked[key] = value.slice(0, 10) + '...';
    } else {
      masked[key] = String(value);
    }
  }
  return masked;
}
