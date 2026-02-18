import { LOCAL_STORAGE_KEYS } from '@/lib/vote/constants';
import type { VoteProfileInput } from '@/lib/vote/types';

type PendingVotesPayload = {
  topicIds: string[];
};

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function getOrCreateGuestToken(): string | null {
  if (!isBrowser()) {
    return null;
  }

  const existing = localStorage.getItem(LOCAL_STORAGE_KEYS.guestToken);
  if (existing) {
    return existing;
  }

  const token = crypto.randomUUID();
  localStorage.setItem(LOCAL_STORAGE_KEYS.guestToken, token);
  return token;
}

export function readPendingProfile(): VoteProfileInput | null {
  if (!isBrowser()) {
    return null;
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.pendingProfile);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as VoteProfileInput;
  } catch {
    return null;
  }
}

export function writePendingProfile(profile: VoteProfileInput): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.setItem(LOCAL_STORAGE_KEYS.pendingProfile, JSON.stringify(profile));
}

export function clearPendingProfile(): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.removeItem(LOCAL_STORAGE_KEYS.pendingProfile);
}

export function readPendingVotes(): string[] {
  if (!isBrowser()) {
    return [];
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.pendingVotes);
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
  if (!isBrowser()) {
    return;
  }

  const current = new Set(readPendingVotes());
  current.add(topicId);
  localStorage.setItem(LOCAL_STORAGE_KEYS.pendingVotes, JSON.stringify({ topicIds: Array.from(current) }));
}

export function clearPendingVotes(): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.removeItem(LOCAL_STORAGE_KEYS.pendingVotes);
}
