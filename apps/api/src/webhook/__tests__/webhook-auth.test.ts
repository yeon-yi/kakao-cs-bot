import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from 'crypto';

function verifyApiKey(apiKey: string | null, secret: string): boolean {
  if (!secret || !apiKey) return false;

  try {
    const keyBuf = Buffer.from(apiKey, 'utf8');
    const secretBuf = Buffer.from(secret, 'utf8');
    if (keyBuf.length !== secretBuf.length) return false;
    return timingSafeEqual(keyBuf, secretBuf);
  } catch {
    return false;
  }
}

describe('Webhook API Key 검증', () => {
  const VALID_SECRET = 'csbot-webhook-2026!secret';

  it('올바른 API key는 통과해야 한다', () => {
    expect(verifyApiKey(VALID_SECRET, VALID_SECRET)).toBe(true);
  });

  it('잘못된 API key는 거부해야 한다', () => {
    expect(verifyApiKey('wrong-key', VALID_SECRET)).toBe(false);
  });

  it('null API key는 거부해야 한다', () => {
    expect(verifyApiKey(null, VALID_SECRET)).toBe(false);
  });

  it('빈 문자열 API key는 거부해야 한다', () => {
    expect(verifyApiKey('', VALID_SECRET)).toBe(false);
  });

  it('빈 secret은 모든 요청을 거부해야 한다', () => {
    expect(verifyApiKey('any-key', '')).toBe(false);
  });

  it('길이가 다른 key는 거부해야 한다', () => {
    expect(verifyApiKey('short', VALID_SECRET)).toBe(false);
    expect(verifyApiKey(VALID_SECRET + 'extra', VALID_SECRET)).toBe(false);
  });

  it('비슷하지만 다른 key는 거부해야 한다', () => {
    const almostRight = VALID_SECRET.slice(0, -1) + 'x';
    expect(verifyApiKey(almostRight, VALID_SECRET)).toBe(false);
  });
});
