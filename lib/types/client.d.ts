/**
 * dsh-archive-cleaner client half type declarations.
 */

export interface SessionMenuItemOwnerProps {
  sessionId: string;
  displayTitle: string;
}

export interface DeleteSessionRequest {
  sessionId: string;
}

export interface DeleteSessionResponse {
  ok: boolean;
  freed: string;
  freedBytes: number;
}

export interface StatusResponse {
  archivedSessionIds: string[];
  pinnedSessionIds: string[];
}

export function apply(ctx: {
  slots: {
    inject(slot: string, factory: () => unknown): void;
  };
}): void;

export const inject: readonly ['slots'];
