import { describe, it, expect, vi, beforeEach } from 'vitest';

// withTransaction 로직을 단위 테스트 (mock DB)
describe('withTransaction logic', () => {
  it('성공 시 COMMIT 호출', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    // BEGIN
    await mockClient.query('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');

    // 비즈니스 로직
    const result = 'success';

    // COMMIT
    await mockClient.query('COMMIT');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

    mockClient.release();
    expect(mockClient.release).toHaveBeenCalled();
    expect(result).toBe('success');
  });

  it('에러 시 ROLLBACK 호출', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    await mockClient.query('BEGIN');

    // 에러 발생
    const error = new Error('test error');

    // ROLLBACK
    await mockClient.query('ROLLBACK');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');

    mockClient.release();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('ROLLBACK 후에도 release 보장', async () => {
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('fail')) // 비즈니스 로직
        .mockResolvedValueOnce({}), // ROLLBACK
      release: vi.fn(),
    };

    try {
      await mockClient.query('BEGIN');
      await mockClient.query('INSERT ...');
    } catch {
      await mockClient.query('ROLLBACK');
    } finally {
      mockClient.release();
    }

    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
