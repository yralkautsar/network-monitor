// hooks/useNetworkStream.ts
// Consumes the SSE stream from /api/network-stream
// Manages connection state, reconnection on drop, and typed data updates

import { useEffect, useRef, useState } from "react";
import type { NetworkSnapshot } from "@/lib/mikrotik";

// How long to wait before reconnecting after a dropped connection (ms)
const RECONNECT_DELAY = 3000;

export type StreamStatus = "connecting" | "connected" | "error" | "reconnecting";

export interface UseNetworkStreamResult {
  data: NetworkSnapshot | null;     // Latest snapshot from MikroTik
  status: StreamStatus;             // Connection state for UI indicators
  error: string | null;             // Last error message if status === "error"
  lastUpdated: number | null;       // Timestamp of last successful data push
}

export function useNetworkStream(): UseNetworkStreamResult {
  const [data, setData] = useState<NetworkSnapshot | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // Ref to hold the EventSource instance — allows cleanup across renders
  const eventSourceRef = useRef<EventSource | null>(null);

  // Ref to hold the reconnect timer — allows cancellation on unmount
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function connect(): void {
      // Clean up any existing connection before opening a new one
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      setStatus("connecting");

      const es = new EventSource("/api/network-stream");
      eventSourceRef.current = es;

      // Default message event — receives NetworkSnapshot JSON
      es.onmessage = (event: MessageEvent) => {
        try {
          const snapshot: NetworkSnapshot = JSON.parse(event.data);
          setData(snapshot);
          setStatus("connected");
          setError(null);
          setLastUpdated(Date.now());
        } catch (parseErr) {
          console.error("[useNetworkStream] Failed to parse snapshot:", parseErr);
        }
      };

      // Named error event — sent by route.ts when a MikroTik poll fails
      es.addEventListener("error", (event: MessageEvent) => {
        try {
          const { message } = JSON.parse(event.data);
          setError(message);
          // Don't set status to error here — stream is still alive, just one bad poll
        } catch {
          // Ignore malformed error events
        }
      });

      // SSE connection-level error — network drop, server restart, etc.
      es.onerror = () => {
        console.warn("[useNetworkStream] Connection lost, reconnecting in", RECONNECT_DELAY, "ms");
        es.close();
        setStatus("reconnecting");
        setError("Connection lost. Reconnecting...");

        // Schedule reconnect
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, RECONNECT_DELAY);
      };
    }

    connect();

    // Cleanup on unmount — close SSE and cancel any pending reconnect
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, []); // Run once on mount — connection manages its own lifecycle

  return { data, status, error, lastUpdated };
}