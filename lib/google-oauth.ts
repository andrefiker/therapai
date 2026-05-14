// lib/google-oauth.ts
//
// Google OAuth client wrapper for per-tenant Calendar integration.
// Used by:
//   - /api/auth/google/start    → build the consent URL (PKCE state-only,
//                                 no client-side secret leak)
//   - /api/auth/google/callback → exchange auth code for tokens, store grant
//   - /api/auth/google/disconnect → revoke + delete grant
//   - /api/cron/scan-calendars  → list upcoming events for active grants
//
// Env required:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REDIRECT_URI  (default: https://therapai-one.vercel.app/api/auth/google/callback)

const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
const GOOGLE_OAUTH_REDIRECT_URI =
  process.env.GOOGLE_OAUTH_REDIRECT_URI ?? 'https://therapai-one.vercel.app/api/auth/google/callback';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
] as const;

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  scope: string;
  token_type: string;
  id_token?: string;
}

export interface GoogleUserInfo {
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export class GoogleOAuthError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'GoogleOAuthError';
    this.status = status;
    this.body = body;
  }
}

export function isGoogleOAuthConfigured(): boolean {
  return !!(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET);
}

/**
 * Build the URL to redirect the user's browser to. State is a random opaque
 * token the caller sets in a short-lived signed cookie; callback validates it.
 */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline', // returns refresh_token on first grant
    prompt: 'consent', // forces refresh_token even if user re-authorized
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange auth code for tokens. Called from /api/auth/google/callback.
 */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GoogleOAuthError(`google token exchange failed: ${res.status}`, res.status, text);
  }
  return JSON.parse(text) as GoogleTokens;
}

/**
 * Refresh an expired access_token using the stored refresh_token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GoogleOAuthError(`google refresh failed: ${res.status}`, res.status, text);
  }
  return JSON.parse(text) as GoogleTokens;
}

/**
 * Revoke a token (access or refresh). Idempotent at Google's end. Used by
 * /api/auth/google/disconnect to invalidate before deleting the grant row.
 */
export async function revokeToken(token: string): Promise<void> {
  const params = new URLSearchParams({ token });
  await fetch(`https://oauth2.googleapis.com/revoke?${params.toString()}`, {
    method: 'POST',
  });
  // Don't throw on non-2xx; revoking an already-invalid token returns 400
  // and that's fine — caller still wants to delete the local grant row.
}

/**
 * Fetch the connected user's basic info. Used by the callback to record
 * which Google account granted access (so the scanner knows which calendar
 * to query when this tenant connected multiple times in the past).
 */
export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GoogleOAuthError(`google userinfo failed: ${res.status}`, res.status, text);
  }
  return JSON.parse(text) as GoogleUserInfo;
}

// ─── Calendar API ────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  summary?: string; // event title
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  hangoutLink?: string; // Google Meet URL
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  organizer?: { email?: string };
  attendees?: Array<{ email?: string; responseStatus?: string }>;
  status?: string;
}

/**
 * List upcoming events from the user's primary calendar. Default window:
 * next 24h. Scanner-only; callable only with a valid access_token.
 */
export async function listUpcomingEvents(
  accessToken: string,
  opts: { hoursAhead?: number; maxResults?: number } = {},
): Promise<CalendarEvent[]> {
  const now = new Date();
  const future = new Date(now.getTime() + (opts.hoursAhead ?? 24) * 3600_000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(opts.maxResults ?? 50),
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GoogleOAuthError(`google calendar list failed: ${res.status}`, res.status, text);
  }
  const data = JSON.parse(text) as { items?: CalendarEvent[] };
  return data.items ?? [];
}

/**
 * Extract the first meeting URL from an event. Returns null if the event has
 * no Meet/Zoom/Teams link.
 */
export function extractMeetingUrl(event: CalendarEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const entries = event.conferenceData?.entryPoints ?? [];
  for (const e of entries) {
    if (e.entryPointType === 'video' && e.uri) return e.uri;
  }
  // Heuristic: scan description for Zoom/Teams patterns
  const desc = event.description ?? '';
  const zoom = desc.match(/https:\/\/[\w-]*\.?zoom\.us\/j\/\S+/i);
  if (zoom) return zoom[0];
  const teams = desc.match(/https:\/\/teams\.microsoft\.com\/[^\s<>"]+/i);
  if (teams) return teams[0];
  const meet = desc.match(/https:\/\/meet\.google\.com\/\S+/i);
  if (meet) return meet[0];
  return null;
}
