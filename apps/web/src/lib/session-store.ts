/**
 * The session the server already loaded for a page request.
 *
 * Keyed by the request object, so a worker that handles many requests keeps no
 * user's answer alive for another (and an entry disappears with its request).
 */
export type PreloadedSession = {
  sessionId: string;
  subjectId: string;
  claims: {
    name: string;
    email: string;
    emailVerified: boolean;
  };
} | null;

const sessions = new WeakMap<Request, PreloadedSession>();

export function setPreloadedSession(request: Request, session: PreloadedSession): void {
  sessions.set(request, session);
}

export function getPreloadedSession(request: Request): PreloadedSession | undefined {
  return sessions.get(request);
}
