import { LOCAL_STORAGE_KEYS } from '@/lib/vote/constants';
import type { SchoolSearchItem, VoteRegionInput } from '@/lib/vote/types';

type PendingVotesPayload = {
  topicIds: string[];
};

type PendingGameScorePayload = {
  runId: string;
  score: number;
  createdAt: string;
};

type ResultIntroSeenPayload = {
  topicIds: string[];
};

const PENDING_GAME_SCORE_TTL_MS = 30 * 60 * 1000;

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

export function writeGuestSessionId(sessionId: string): void {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return;
  }

  const normalized = sessionId.trim();
  if (!normalized) {
    return;
  }

  sessionStorageRef.setItem(LOCAL_STORAGE_KEYS.guestSessionId, normalized);
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

function parsePendingRegionInput(raw: string | null): VoteRegionInput | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (
      'source' in parsed &&
      ((parsed as { source?: string }).source === 'school' ||
        (parsed as { source?: string }).source === 'gps')
    ) {
      return parsed as VoteRegionInput;
    }

    // Legacy payload migration: { birthYear, gender, school }
    if ('school' in parsed) {
      const school = (parsed as { school?: unknown }).school;
      if (school && typeof school === 'object') {
        return {
          source: 'school',
          school: school as SchoolSearchItem,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function readPendingRegionInput(): VoteRegionInput | null {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return null;
  }

  const raw = sessionStorageRef.getItem(LOCAL_STORAGE_KEYS.pendingRegionInput);
  const parsed = parsePendingRegionInput(raw);
  if (parsed) {
    return parsed;
  }

  const legacyRaw = sessionStorageRef.getItem(LOCAL_STORAGE_KEYS.legacyPendingProfile);
  const migrated = parsePendingRegionInput(legacyRaw);
  if (migrated) {
    sessionStorageRef.setItem(LOCAL_STORAGE_KEYS.pendingRegionInput, JSON.stringify(migrated));
    sessionStorageRef.removeItem(LOCAL_STORAGE_KEYS.legacyPendingProfile);
  }

  return migrated;
}

export function writePendingRegionInput(regionInput: VoteRegionInput): void {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return;
  }

  sessionStorageRef.setItem(LOCAL_STORAGE_KEYS.pendingRegionInput, JSON.stringify(regionInput));
  sessionStorageRef.removeItem(LOCAL_STORAGE_KEYS.legacyPendingProfile);
}

export function clearPendingRegionInput(): void {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return;
  }

  sessionStorageRef.removeItem(LOCAL_STORAGE_KEYS.pendingRegionInput);
  sessionStorageRef.removeItem(LOCAL_STORAGE_KEYS.legacyPendingProfile);
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

function parsePendingGameScore(raw: string | null): PendingGameScorePayload | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PendingGameScorePayload;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (typeof parsed.runId !== 'string' || !parsed.runId.trim()) {
      return null;
    }

    if (
      typeof parsed.score !== 'number' ||
      !Number.isFinite(parsed.score) ||
      parsed.score < 0 ||
      parsed.score > 9999
    ) {
      return null;
    }

    if (typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt))) {
      return null;
    }

    return {
      runId: parsed.runId,
      score: Math.trunc(parsed.score),
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

export function readPendingGameScore(): PendingGameScorePayload | null {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return null;
  }

  const parsed = parsePendingGameScore(sessionStorageRef.getItem(LOCAL_STORAGE_KEYS.pendingGameScore));
  if (!parsed) {
    sessionStorageRef.removeItem(LOCAL_STORAGE_KEYS.pendingGameScore);
    return null;
  }

  const createdAtMs = Date.parse(parsed.createdAt);
  if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > PENDING_GAME_SCORE_TTL_MS) {
    sessionStorageRef.removeItem(LOCAL_STORAGE_KEYS.pendingGameScore);
    return null;
  }

  return parsed;
}

export function writePendingGameScore(payload: PendingGameScorePayload): void {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return;
  }

  const normalized: PendingGameScorePayload = {
    runId: payload.runId,
    score: Math.min(9999, Math.max(0, Math.trunc(payload.score))),
    createdAt: payload.createdAt,
  };

  sessionStorageRef.setItem(LOCAL_STORAGE_KEYS.pendingGameScore, JSON.stringify(normalized));
}

export function clearPendingGameScore(): void {
  const sessionStorageRef = getSessionStorage();
  if (!sessionStorageRef) {
    return;
  }

  sessionStorageRef.removeItem(LOCAL_STORAGE_KEYS.pendingGameScore);
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
