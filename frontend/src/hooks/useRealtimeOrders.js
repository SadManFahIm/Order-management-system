import { useEffect, useRef, useState } from 'react';
import { getAccessToken } from '../api';

/**
 * Real-time kitchen/delivery queue (Phase 5).
 *
 * Connects to the backend WebSocket (/ws) with the access token, delivers
 * order events (order.created / status_changed / assigned) to `onEvent`, and
 * reports whether the socket is live via the returned `connected` flag so the
 * caller can keep its 30s polling as a fallback whenever the socket is down.
 *
 * Reconnect uses exponential backoff (1s → 2s → 4s → … capped at 15s); the
 * event handler is kept in a ref so reconnects never miss a subscription.
 */
const BACKOFF_CAP_MS = 15_000;

export function useRealtimeOrders({ enabled = true, tenantId, onEvent, onConnect } = {}) {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onConnectRef = useRef(onConnect);
  onConnectRef.current = onConnect;

  useEffect(() => {
    if (!enabled) return undefined;

    let ws = null;
    let retries = 0;
    let reconnectTimer = null;
    let closed = false;

    const connect = () => {
      const token = getAccessToken();
      if (!token) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      // The ACTIVE workspace rides along as ?tenant= — the backend validates
      // it like the REST X-Tenant header, so a user switched to another
      // workspace still hears that workspace's room (not the token's default).
      const qs = tenantId ? `&tenant=${encodeURIComponent(tenantId)}` : '';
      try {
        ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${token}${qs}`);
      } catch {
        return;
      }

      ws.onopen = () => {
        retries = 0;
        setConnected(true);
        // Resync after every (re)connect: events emitted while the socket was
        // down would otherwise be missed forever once polling pauses.
        onConnectRef.current?.();
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event && msg.event !== 'hello') onEventRef.current?.(msg);
        } catch {
          /* non-JSON control frame — ignore */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        const delay = Math.min(1000 * 2 ** retries, BACKOFF_CAP_MS);
        retries += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [enabled, tenantId]);

  return connected;
}
