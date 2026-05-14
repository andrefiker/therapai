// app/api/cron/scan-calendars/route.ts
//
// Vercel cron entry point. Iterates active Google OAuth grants for therapists
// with auto_launch_calendar_bot=true; refreshes their access tokens when
// needed; lists upcoming events; launches a Recall bot for each event that
// has a meeting URL AND hasn't already been launched (idempotent via
// therapai_calendar_launches).
//
// Trigger: configure as a Vercel cron in vercel.json (every 5-10 minutes).
// Auth: requires Authorization: Bearer $CRON_SECRET header so it can't be
// hit by anonymous traffic.

import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  refreshAccessToken,
  listUpcomingEvents,
  extractMeetingUrl,
  GoogleOAuthError,
} from '@/lib/google-oauth';
import { createBotForTherapist, RecallApiError } from '@/lib/recall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET ?? '';

interface Grant {
  therapist_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  granted_email: string | null;
}

interface ScanResult {
  therapist_id: string;
  events_scanned: number;
  launched: number;
  skipped_already_launched: number;
  skipped_no_url: number;
  errors: string[];
}

export async function GET(req: NextRequest) {
  // Auth: either a cron-secret bearer (production cron) or a query secret
  // (manual trigger by operator). Vercel cron auto-injects the bearer if
  // configured in vercel.json with `crons` block.
  const auth = req.headers.get('authorization') ?? '';
  const querySecret = new URL(req.url).searchParams.get('secret');
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  }
  if (auth !== `Bearer ${CRON_SECRET}` && querySecret !== CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Enumerate therapists with auto_launch enabled AND an active Google grant
  const { data: therapists, error: tErr } = await supabaseAdmin
    .from('therapai_therapists')
    .select('id, email, auto_launch_calendar_bot')
    .eq('auto_launch_calendar_bot', true);
  if (tErr) return NextResponse.json({ error: 'therapists_fetch_failed', message: tErr.message }, { status: 500 });

  const eligibleIds = (therapists ?? []).map((t) => t.id);
  if (eligibleIds.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, results: [], note: 'no therapists with auto_launch_calendar_bot=true' });
  }

  const { data: grants, error: gErr } = await supabaseAdmin
    .from('therapai_therapist_oauth_grants')
    .select('therapist_id, access_token, refresh_token, expires_at, granted_email')
    .eq('provider', 'google')
    .in('therapist_id', eligibleIds);
  if (gErr) return NextResponse.json({ error: 'grants_fetch_failed', message: gErr.message }, { status: 500 });

  const results: ScanResult[] = [];
  for (const g of (grants ?? []) as Grant[]) {
    const r = await scanForTherapist(g);
    results.push(r);
  }

  return NextResponse.json({ ok: true, scanned: results.length, results });
}

async function scanForTherapist(grant: Grant): Promise<ScanResult> {
  const result: ScanResult = {
    therapist_id: grant.therapist_id,
    events_scanned: 0,
    launched: 0,
    skipped_already_launched: 0,
    skipped_no_url: 0,
    errors: [],
  };

  let accessToken = grant.access_token;
  const expired = new Date(grant.expires_at) <= new Date();
  if (expired) {
    if (!grant.refresh_token) {
      result.errors.push('expired_and_no_refresh_token');
      return result;
    }
    try {
      const refreshed = await refreshAccessToken(grant.refresh_token);
      accessToken = refreshed.access_token;
      const newExpiresAt = new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString();
      await supabaseAdmin
        .from('therapai_therapist_oauth_grants')
        .update({ access_token: accessToken, expires_at: newExpiresAt, updated_at: new Date().toISOString() })
        .eq('therapist_id', grant.therapist_id)
        .eq('provider', 'google');
    } catch (err) {
      const msg = err instanceof GoogleOAuthError ? `refresh_failed:${err.status}` : `refresh_failed:${(err as Error).message}`;
      result.errors.push(msg);
      return result;
    }
  }

  let events;
  try {
    events = await listUpcomingEvents(accessToken, { hoursAhead: 24 });
  } catch (err) {
    result.errors.push(err instanceof GoogleOAuthError ? `list_failed:${err.status}` : `list_failed:${(err as Error).message}`);
    return result;
  }
  result.events_scanned = events.length;

  // Existing launches for this therapist (idempotency)
  const { data: existing } = await supabaseAdmin
    .from('therapai_calendar_launches')
    .select('calendar_event_id')
    .eq('therapist_id', grant.therapist_id)
    .eq('provider', 'google');
  const launchedSet = new Set((existing ?? []).map((r) => r.calendar_event_id));

  for (const event of events) {
    if (launchedSet.has(event.id)) {
      result.skipped_already_launched++;
      continue;
    }
    const meetingUrl = extractMeetingUrl(event);
    if (!meetingUrl) {
      result.skipped_no_url++;
      continue;
    }
    // Skip events that already started >5min ago (too late to join usefully)
    const startIso = event.start?.dateTime ?? event.start?.date;
    if (startIso) {
      const start = new Date(startIso).getTime();
      if (Number.isFinite(start) && start < Date.now() - 5 * 60 * 1000) {
        result.skipped_no_url++; // bucketed; not worth a new counter
        continue;
      }
    }

    try {
      const bot = await createBotForTherapist({
        meetingUrl,
        therapistId: grant.therapist_id,
        botName: event.summary ? `TherapAI · ${event.summary.slice(0, 80)}` : 'TherapAI',
        extraMetadata: {
          calendar_event_id: event.id,
          calendar_event_title: event.summary ?? '',
        },
      });
      await supabaseAdmin
        .from('therapai_calendar_launches')
        .insert({
          therapist_id: grant.therapist_id,
          provider: 'google',
          calendar_event_id: event.id,
          meeting_url: meetingUrl,
          bot_id: bot.id,
          status: 'launched',
        });
      result.launched++;
    } catch (err) {
      const msg = err instanceof RecallApiError ? `recall_${err.status}` : (err as Error).message;
      await supabaseAdmin
        .from('therapai_calendar_launches')
        .insert({
          therapist_id: grant.therapist_id,
          provider: 'google',
          calendar_event_id: event.id,
          meeting_url: meetingUrl,
          status: 'failed',
          error: msg.slice(0, 500),
        });
      result.errors.push(`event_${event.id}:${msg}`);
    }
  }

  return result;
}
