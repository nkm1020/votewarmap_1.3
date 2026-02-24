import { LOCAL_STORAGE_KEYS } from '@/lib/vote/constants';
import type { VoteProfileInput } from '@/lib/vote/types';

type PendingVotesPayload = {
  topicIds: string[];
};

type ResultIntroSeenPayload = {
  topicIds: string[];
};

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function createUuid(): string {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function migrateLegacyGuestToken(sessionStorageRef: Storage): string | null {
  const legacyToken = localStorage.getItem(LOCAL_STORAGE_KEYS.legacyGuestToken);
  if (!legacyToken) {
    return null;
  }

  sessionStorageRef.setItem(LOCAL_STORAGE_KEYS.guestSessionId, legacyToken);
  localStorage.removeItem(LOCAL_STORAGE_KEYS.legacyGuestToken);
  return legacyToken;
}

function getSessionStorage(): Storage | null {
  if (!isBrowser()) {
    return null;
  }

  return window.sessionStorage;
}

export function readGuestSessionId(): string | null {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return null;
  }

  return (
    sessionStorageRef.getItem(LOCAL_STORAGE_KEYS.guestSessionId) ??
    migrateLegacyGuestToken(sessionStorageRef)
  );
}

export function getOrCreateGuestSessionId(): string | null {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return null;
  }

  const existing =
    sessionStorageRef.getItem(LOCAL_STORAGE_KEYS.guestSessionId) ??
    migrateLegacyGuestToken(sessionStorageRef);
  if (existing) {
    return existing;
  }

  const sessionId = createUuid();
  sessionStorageRef.setItem(LOCAL_STORAGE_KEYS.guestSessionId, sessionId);
  return sessionId;
}

// Backward-compatible alias used by legacy callers.
export function getOrCreateGuestToken(): string | null {
  return getOrCreateGuestSessionId();
}

export function clearGuestSessionId(): void {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return;
  }

  sessionStorageRef.removeItem(LOCAL_STORAGE_KEYS.guestSessionId);
  localStorage.removeItem(LOCAL_STORAGE_KEYS.legacyGuestToken);
}

export function readPendingProfile(): VoteProfileInput | null {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return null;
  }

  try {
    const raw = sessionStorageRef.getItem(LOCAL_STORAGE_KEYS.pendingProfile);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as VoteProfileInput;
  } catch {
    return null;
  }
}

export function writePendingProfile(profile: VoteProfileInput): void {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return;
  }

  sessionStorageRef.setItem(LOCAL_STORAGE_KEYS.pendingProfile, JSON.stringify(profile));
}

export function clearPendingProfile(): void {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return;
  }

  sessionStorageRef.removeItem(LOCAL_STORAGE_KEYS.pendingProfile);
}

export function readPendingVotes(): string[] {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return [];
  }

  try {
    const raw = sessionStorageRef.getItem(LOCAL_STORAGE_KEYS.pendingVotes);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as PendingVotesPayload | string[];
    if (Array.isArray(parsed)) {
      return parsed;
    }

    return Array.isArray(parsed.topicIds) ? parsed.topicIds : [];
  } catch {
    return [];
  }
}

export function addPendingVoteTopic(topicId: string): void {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return;
  }

  const current = new Set(readPendingVotes());
  current.add(topicId);
  sessionStorageRef.setItem(
    LOCAL_STORAGE_KEYS.pendingVotes,
    JSON.stringify({ topicIds: Array.from(current) }),
  );
}

export function clearPendingVotes(): void {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return;
  }

  sessionStorageRef.removeItem(LOCAL_STORAGE_KEYS.pendingVotes);
}

export function readResultIntroSeenTopicIds(): string[] {
  if (!isBrowser()) {
    return [];
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.resultIntroSeenByTopic);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as ResultIntroSeenPayload | string[];
    if (Array.isArray(parsed)) {
      return parsed.filter((topicId) => typeof topicId === 'string');
    }

    if (!Array.isArray(parsed.topicIds)) {
      return [];
    }

    return parsed.topicIds.filter((topicId) => typeof topicId === 'string');
  } catch {
    return [];
  }
}

export function hasSeenResultIntroForTopic(topicId: string): boolean {
  if (!topicId) {
    return false;
  }

  return readResultIntroSeenTopicIds().includes(topicId);
}

export function markResultIntroSeenForTopic(topicId: string): void {
  if (!isBrowser() || !topicId) {
    return;
  }

  const next = new Set(readResultIntroSeenTopicIds());
  next.add(topicId);

  localStorage.setItem(
    LOCAL_STORAGE_KEYS.resultIntroSeenByTopic,
    JSON.stringify({ topicIds: Array.from(next) }),
  );
}
