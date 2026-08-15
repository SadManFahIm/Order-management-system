import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from '../utils/logger.js';

/**
 * Structured logger (Phase 1 foundation) — every call carries the requestId
 * (and any context) alongside the message, so logs can be correlated to the
 * request that produced them. Dev/test format is human-readable; production
 * is one JSON object per line (verified here by the field contract).
 */

describe('logger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes an info line carrying requestId + context fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('request', { requestId: 'abc-123', method: 'GET', status: 200 });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0];
    expect(line).toContain('INFO');
    expect(line).toContain('request');
    expect(line).toContain('"requestId":"abc-123"');
    expect(line).toContain('"method":"GET"');
    expect(line).toContain('"status":200');
  });

  it('writes errors to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('request failed', { requestId: 'x-1', error: 'boom' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('boom');
  });

  it('tolerates missing metadata', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('no meta');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
