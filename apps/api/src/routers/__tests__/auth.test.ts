import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-jwt-secret-key-at-least-32-characters-long';
const TEST_PASSWORD = 'testpassword123';
const BCRYPT_ROUNDS = 12;

describe('Auth - bcrypt 비밀번호 해싱', () => {
  it('bcrypt hash를 생성하고 검증할 수 있어야 한다', async () => {
    const hash = await bcrypt.hash(TEST_PASSWORD, BCRYPT_ROUNDS);

    expect(hash).toMatch(/^\$2[ab]\$/);
    expect(await bcrypt.compare(TEST_PASSWORD, hash)).toBe(true);
    expect(await bcrypt.compare('wrongpassword', hash)).toBe(false);
  });

  it('같은 비밀번호라도 다른 hash를 생성해야 한다', async () => {
    const hash1 = await bcrypt.hash(TEST_PASSWORD, BCRYPT_ROUNDS);
    const hash2 = await bcrypt.hash(TEST_PASSWORD, BCRYPT_ROUNDS);

    expect(hash1).not.toBe(hash2);
    expect(await bcrypt.compare(TEST_PASSWORD, hash1)).toBe(true);
    expect(await bcrypt.compare(TEST_PASSWORD, hash2)).toBe(true);
  });

  it('bcrypt hash인지 평문인지 구분할 수 있어야 한다', async () => {
    const hash = await bcrypt.hash(TEST_PASSWORD, BCRYPT_ROUNDS);
    const isBcrypt = (s: string) => s.startsWith('$2b$') || s.startsWith('$2a$');

    expect(isBcrypt(hash)).toBe(true);
    expect(isBcrypt(TEST_PASSWORD)).toBe(false);
    expect(isBcrypt('admin1616@')).toBe(false);
  });
});

describe('Auth - JWT 토큰', () => {
  it('access token은 type=access로 생성되어야 한다', () => {
    const token = jwt.sign(
      { sub: 'admin', role: 'admin', type: 'access' },
      TEST_SECRET,
      { expiresIn: '8h' },
    );
    const decoded = jwt.verify(token, TEST_SECRET) as any;

    expect(decoded.sub).toBe('admin');
    expect(decoded.role).toBe('admin');
    expect(decoded.type).toBe('access');
  });

  it('refresh token은 type=refresh로 생성되어야 한다', () => {
    const token = jwt.sign(
      { sub: 'admin', role: 'admin', type: 'refresh' },
      TEST_SECRET,
      { expiresIn: '30d' },
    );
    const decoded = jwt.verify(token, TEST_SECRET) as any;

    expect(decoded.type).toBe('refresh');
  });

  it('잘못된 secret으로 검증하면 실패해야 한다', () => {
    const token = jwt.sign({ sub: 'admin' }, TEST_SECRET);

    expect(() => jwt.verify(token, 'wrong-secret-key-at-least-32-chars')).toThrow();
  });

  it('만료된 토큰은 검증에 실패해야 한다', () => {
    const token = jwt.sign(
      { sub: 'admin' },
      TEST_SECRET,
      { expiresIn: '-1s' },
    );

    expect(() => jwt.verify(token, TEST_SECRET)).toThrow();
  });

  it('refresh token으로 access token을 재발급할 수 있어야 한다', () => {
    const refreshToken = jwt.sign(
      { sub: 'admin', role: 'admin', type: 'refresh' },
      TEST_SECRET,
      { expiresIn: '30d' },
    );

    const decoded = jwt.verify(refreshToken, TEST_SECRET) as any;
    expect(decoded.type).toBe('refresh');

    const newAccessToken = jwt.sign(
      { sub: decoded.sub, role: decoded.role, type: 'access' },
      TEST_SECRET,
      { expiresIn: '8h' },
    );

    const newDecoded = jwt.verify(newAccessToken, TEST_SECRET) as any;
    expect(newDecoded.sub).toBe('admin');
    expect(newDecoded.type).toBe('access');
  });
});
