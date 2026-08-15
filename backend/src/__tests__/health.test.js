import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';

/**
 * Health / readiness endpoints (Phase 1 foundation) — liveness probes answer
 * without touching dependencies, readiness checks the DB connection, and both
 * echo the request id so probes can be correlated with request logs.
 */

describe('health & readiness endpoints', () => {
  it('serves liveness on /api/health with a request id echoed in the header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('keeps the legacy /health alias working', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('reports readiness ok when the database authenticates', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
    expect(res.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
