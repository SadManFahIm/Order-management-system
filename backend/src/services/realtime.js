import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UserTenant } from '../models/index.js';
import { hasPermission } from '../config/roles.js';

/**
 * Real-time kitchen/delivery queue (Phase 5) — WebSocket hub.
 *
 * Architecture: a single `ws` server attached to the HTTP server at /ws.
 * Connections authenticate with the same JWT access token (browser
 * WebSockets cannot set headers, so the token travels as a query param and
 * is verified server-side exactly like the REST middleware). The client then
 * subscribes to exactly one room: `tenant:{id}` — validated against the DB
 * membership (never trusting client claims) and gated to roles that can see
 * orders (kitchen / delivery / manager / owner / platform_admin).
 *
 * Redis pub/sub is deliberately NOT added: this monolith runs one instance
 * today, and the roadmap's multi-instance Redis layer can be added behind
 * this same `publish()` seam later without changing callers. Until then the
 * in-process hub keeps zero extra infrastructure.
 *
 * Emitted events (payloads are whitelisted — no customer phone/address):
 *   { event: 'order.created',       order: {...} }
 *   { event: 'order.status_changed', order: {...} }
 *   { event: 'order.assigned',       order: {...} }
 */
let hub = null;

/** Whitelisted, tenant-safe order projection for the wire. */
export function orderEventPayload(order) {
  const items = (order.items || []).map((i) => ({
    name: i.item_name ?? i.name,
    quantity: Number(i.quantity || 0),
  }));
  return {
    id: order.id,
    order_no: order.order_no,
    status: order.status,
    type: order.type,
    table_no: order.table_no ?? null,
    scheduled_at: order.scheduled_at ?? null,
    delivery_fee: Number(order.delivery_fee || 0),
    payment_status: order.payment_status,
    payment_method: order.payment_method ?? null,
    grand_total: Number(order.grand_total ?? order.total_amount ?? 0),
    customer_name: order.customer_name ?? null,
    assigned_to: order.assigned_to ?? null,
    items,
  };
}

/** Broadcasts an event to every client subscribed to the tenant's room. */
export function publishOrderEvent(tenantId, event, order) {
  if (!hub) return;
  const payload = JSON.stringify({ event, order: orderEventPayload(order) });
  hub.broadcast(`tenant:${tenantId}`, payload);
}

const HEARTBEAT_MS = 30_000;

/**
 * Attaches the WebSocket server to the HTTP server. Must be called once at
 * boot (backend/src/index.js) with the server returned by app.listen().
 */
export function attachRealtime(server) {
  if (hub) return hub;

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Auth — the access token arrives as ?token= (browser WS can't set
    // headers). Same verification as the REST authMiddleware. The ACTIVE
    // workspace arrives as ?tenant= and mirrors the REST tenant middleware's
    // priority (explicit tenant switch > the tenant baked into the token),
    // because a user can switch workspaces in the UI after login.
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token');
      if (!token) throw new Error('missing token');
      const payload = jwt.verify(token, env.JWT_SECRET);

      // Resolve + validate the tenant membership against the DB. Only roles
      // with view:orders may join the room.
      const claimed = url.searchParams.get('tenant');
      const tenantId = Number(claimed) || Number(payload.tenant_id);
      if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error('no tenant context');

      let user = payload;
      if (payload.platform_role !== 'platform_admin') {
        const membership = await UserTenant.findOne({
          where: { user_id: payload.id, tenant_id: tenantId },
        });
        if (!membership) throw new Error('not a member');
        user = { ...payload, tenant_role: membership.role };
      } else {
        user = { ...payload, tenant_role: 'owner' };
      }

      if (!hasPermission(user, 'view:orders')) {
        throw new Error('insufficient role');
      }

      const room = `tenant:${tenantId}`;
      ws.room = room;
      if (!hub.rooms.has(room)) hub.rooms.set(room, new Set());
      hub.rooms.get(room).add(ws);
      ws.send(
        JSON.stringify({
          event: 'hello',
          role: user.tenant_role,
          tenantId,
        })
      );

      ws.on('close', () => {
        hub?.rooms.get(room)?.delete(ws);
      });
    } catch {
      ws.close(4401, 'unauthorized');
    }
  });

  // Heartbeat — terminate connections that stop answering pings.
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(interval));

  hub = {
    wss,
    rooms: new Map(),
    broadcast(room, payload) {
      const members = hub.rooms.get(room);
      if (!members) return;
      for (const ws of members) {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      }
    },
    // Test helper: the set of ws clients currently in a room.
    roomSize(room) {
      return hub.rooms.get(room)?.size ?? 0;
    },
  };
  return hub;
}

/** Returns the hub (null before attachRealtime). Used by tests. */
export function getRealtime() {
  return hub;
}
