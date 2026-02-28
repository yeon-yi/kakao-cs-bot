import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// env.ts의 스키마를 재현하여 검증 로직 테스트
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  API_PORT: z.coerce.number().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ADMIN_PASSWORD: z.string().min(4),
  WEBHOOK_SECRET: z.string().min(1),
});

describe('환경변수 검증 스키마', () => {
  const validEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    OPENAI_API_KEY: 'sk-test-key',
    JWT_SECRET: 'a-very-long-secret-key-at-least-32-characters',
    ADMIN_PASSWORD: 'test1234',
    WEBHOOK_SECRET: 'webhook-secret',
  };

  it('모든 필수값이 있으면 파싱 성공해야 한다', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
  });

  it('DATABASE_URL 누락 시 실패해야 한다', () => {
    const { DATABASE_URL, ...rest } = validEnv;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('OPENAI_API_KEY 누락 시 실패해야 한다', () => {
    const { OPENAI_API_KEY, ...rest } = validEnv;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('JWT_SECRET이 32자 미만이면 실패해야 한다', () => {
    const result = envSchema.safeParse({ ...validEnv, JWT_SECRET: 'short' });
    expect(result.success).toBe(false);
  });

  it('ADMIN_PASSWORD가 4자 미만이면 실패해야 한다', () => {
    const result = envSchema.safeParse({ ...validEnv, ADMIN_PASSWORD: '123' });
    expect(result.success).toBe(false);
  });

  it('NODE_ENV 기본값은 development여야 한다', () => {
    const result = envSchema.parse(validEnv);
    expect(result.NODE_ENV).toBe('development');
  });

  it('NODE_ENV에 잘못된 값은 실패해야 한다', () => {
    const result = envSchema.safeParse({ ...validEnv, NODE_ENV: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('API_PORT는 숫자로 변환되어야 한다', () => {
    const result = envSchema.parse({ ...validEnv, API_PORT: '8080' });
    expect(result.API_PORT).toBe(8080);
  });

  it('API_PORT 범위 초과 시 실패해야 한다', () => {
    const result = envSchema.safeParse({ ...validEnv, API_PORT: '99999' });
    expect(result.success).toBe(false);
  });

  it('WEBHOOK_SECRET 누락 시 실패해야 한다', () => {
    const { WEBHOOK_SECRET, ...rest } = validEnv;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
