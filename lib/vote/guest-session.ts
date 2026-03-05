'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readGuestSessionId, writeGuestSessionId } from '@/lib/vote/client-storage';

type HeartbeatResponse = {
  sessionId?: string;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

type UseGuestSessionHeartbeatOptions = {
  enabled: boolean;
  intervalMs?: number;
};

export function useGuestSessionHeartbeat({
  enabled,
  intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
}: UseGuestSessionHeartbeatOptions): string | null {
  const [sessionId, setSessionId] = useState<string | null>(() =>
    enabled ? readGuestSessionId() : null,
  );
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const heartbeat = useCallback(async () => {
    if (!enabled || inFlightRef.current) {
      return;
    }

    const currentSessionId = readGuestSessionId();

    inFlightRef.current = true;
    try {
      const response = await fetch('/api/votes/guest-session/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentSessionId ? { sessionId: currentSessionId } : {}),
      });

      if (!response.ok) {
        setSessionId(currentSessionId ?? null);
        return;
      }

      const json = (await response.json()) as HeartbeatResponse;
      const resolvedSessionId = json.sessionId ?? currentSessionId ?? null;
      if (resolvedSessionId) {
        writeGuestSessionId(resolvedSessionId);
      }
      setSessionId(resolvedSessionId);
    } catch {
      setSessionId(currentSessionId ?? null);
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      setSessionId(null);
      return;
    }

    let disposed = false;

    const ensureStarted = async () => {
      await heartbeat();
      if (disposed || document.visibilityState !== 'visible') {
        return;
      }

      clearTimer();
      timerRef.current = window.setInterval(() => {
        void heartbeat();
      }, intervalMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearTimer();
        return;
      }

      void ensureStarted();
    };

    void ensureStarted();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clearTimer, enabled, heartbeat, intervalMs]);

  return sessionId;
}
