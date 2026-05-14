// app/api/recall/webhook/route.ts
//
// Recall.ai webhook handler — receives meeting-recording lifecycle events,
// fetches the transcript, resolves the owning therapist, identifies the
// patient, and runs the full analysis pipeline (molar → analysis save →
// molecular → assertions → longitudinal). Parallel ingest path to the
// Fireflies handler at /api/webhook; both now flow through lib/ingest.ts.
//
// Webhook contract (per docs.recall.ai/docs/recording-webhooks +
// docs.recall.ai/docs/authenticating-requests-from-recallai):
// - Headers: webhook-id, webhook-timestamp, webhook-signature ("v1,<b64>")
// - Signed string: `{webhook-id}.{webhook-timestamp}.{raw body}`
// - Algorithm: HMAC-SHA256, key = base64-decoded(secret without "whsec_" prefix)
// - Event filter: only `transcript.done` triggers a transcript fetch + ingest.
// - Idempotency key: data.bot.id (one analysis per bot/meeting).
//
// Env required:
// - RECALL_WEBHOOK_SECRET  ("whsec_..." from Recall dashboard Developers > Endpoints)
// - RECALL_API_KEY         (workspace API key from same dashboard)
// - RECALL_API_BASE        (optional; default https://us-west-2.recall.ai/api/v1)

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  identifyPatient,
  matchOrNullPatient,
  runFullAnalysisPipeline,
  ProviderError,
  type MeetingMetadata,
  type IngestContext,
} from '@/lib/ingest';

export const runtime = 'nodejs';
export const maxDuration = 300;

const RECALL_WEBHOOK_SECRET = process.env.RECALL_WEBHOOK_SECRET ?? '';
const RECALL_API_KEY = process.env.RECALL_API_KEY ?? '';
const RECALL_API_BASE = process.env.RECALL_API_BASE ?? 'https://us-west-2.recall.ai/api/v1';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const FALLBACK_THERAPIST_ID =
  process.env.THERAPAI_FALLBACK_THERAPIST_ID ?? '60fdab49-c4dd-45cc-9e2b-51bec3504d35';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecallWebhookPayload {
  event: string;
  data: {
    bot?: { id: string; metadata?: Record<string, unknown> };
    transcript?: { id: string };
    recording?: { id: string };
  };
}

interface RecallParticipant {
  name?: string | null;
  email?: string | null;
  is_host?: boolean;
}

interface RecallBotResponse {
  id: string;
  meeting_url?: { meeting_id?: string; platform?: string };
  meeting_metadata?: { title?: string | null };
  meeting_participants?: RecallParticipant[];
  calendar_meetings?: Array<{
    organizer_email?: string | null;
    attendees?: Array<{ email?: string | null }>;
  }>;
  recording?: { completed_at?: string | null; started_at?: string | null };
  media_shortcuts?: {
    transcript?: { data?: { download_url?: string } };
  };
}

interface RecallTranscriptSegment {
  speaker: string | null;
  words: Array<{
    text: string;
    start_timestamp: { relative: number };
    end_timestamp: { relative: number };
  }>;
}

// ─── Signature verification (Svix format) ─────────────────────────────────────

function verifySignature(req: NextRequest, rawBody: string): boolean {
  if (!RECALL_WEBHOOK_SECRET) return false;
  const id = req.headers.get('webhook-id');
  const ts = req.headers.get('webhook-timestamp');
  const sigHeader = req.headers.get('webhook-signature');
  if (!id || !ts || !sigHeader) return false;

  const now = Math.floor(Date.now() / 1000);
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 300) return false;

  const secretRaw = RECALL_WEBHOOK_SECRET.startsWith('whsec_')
    ? RECALL_WEBHOOK_SECRET.slice(6)
    : RECALL_WEBHOOK_SECRET;
  const key = Buffer.from(secretRaw, 'base64');

  const toSign = `${id}.${ts}.${rawBody}`;
  const expected = createHmac('sha256', key).update(toSign).digest('base64');
  const expectedBuf = Buffer.from(expected, 'base64');

  for (const candidate of sigHeader.split(' ')) {
    const [version, sig] = candidate.split(',');
    if (version !== 'v1' || !sig) continue;
    try {
      const sigBuf = Buffer.from(sig, 'base64');
      if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) return true;
    } catch {
      /* fall through */
    }
  }
  return false;
}

// ─── Recall API ───────────────────────────────────────────────────────────────

async function fetchBot(botId: string): Promise<RecallBotResponse> {
  const res = await fetch(`${RECALL_API_BASE}/bot/${botId}`, {
    headers: { Authorization: `Token ${RECALL_API_KEY}` },
  });
  if (!res.ok) throw new Error(`recall bot fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RecallBotResponse;
}

async function fetchTranscriptSegments(downloadUrl: string): Promise<RecallTranscriptSegment[]> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`recall transcript download failed: ${res.status}`);
  return (await res.json()) as RecallTranscriptSegment[];
}

function flattenSegments(segments: RecallTranscriptSegment[]): string {
  const lines: string[] = [];
  for (const s of segments) {
    const words = (s.words ?? []).map((w) => w.text).join(' ').trim();
    if (!words) continue;
    const startSec = s.words?.[0]?.start_timestamp?.relative ?? 0;
    const m = Math.floor(startSec / 60).toString().padStart(2, '0');
    const ss = Math.floor(startSec % 60).toString().padStart(2, '0');
    lines.push(`[${m}:${ss}] ${s.speaker ?? 'Speaker'}: ${words}`);
  }
  return lines.join('\n');
}

function speakerCounts(segments: RecallTranscriptSegment[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of segments) {
    const name = (s.speaker ?? '').trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

// ─── Therapist resolution ─────────────────────────────────────────────────────

async function resolveTherapistId(
  supabase: SupabaseClient,
  bot: RecallBotResponse,
): Promise<string> {
  const emails: string[] = [];
  for (const p of bot.meeting_participants ?? []) {
    if (p.email) emails.push(p.email.toLowerCase().trim());
  }
  for (const cm of bot.calendar_meetings ?? []) {
    if (cm.organizer_email) emails.push(cm.organizer_email.toLowerCase().trim());
    for (const a of cm.attendees ?? []) {
      if (a.email) emails.push(a.email.toLowerCase().trim());
    }
  }
  const filtered = [...new Set(emails)].filter((e) => e.length > 0 && e.includes('@'));
  if (filtered.length === 0) return FALLBACK_THERAPIST_ID;

  const { data } = await supabase
    .from('therapai_therapists')
    .select('id, email')
    .in('email', filtered);
  if (!data || data.length === 0) return FALLBACK_THERAPIST_ID;

  // Prefer the host's email if available
  const hostEmail = (bot.meeting_participants ?? []).find((p) => p.is_host)?.email?.toLowerCase().trim();
  if (hostEmail) {
    const hit = data.find((r) => r.email.toLowerCase() === hostEmail);
    if (hit) return hit.id;
  }

  // Otherwise: first match in priority order of candidates
  for (const e of filtered) {
    const hit = data.find((r) => r.email.toLowerCase() === e);
    if (hit) return hit.id;
  }
  return FALLBACK_THERAPIST_ID;
}

// ─── Session row management ───────────────────────────────────────────────────

function normalizeSessionDate(input?: string | null): string {
  if (!input) return new Date().toISOString().slice(0, 10);
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

async function upsertProcessingSession(
  supabase: SupabaseClient,
  therapistId: string,
  recallBotId: string,
  sessionDate: string,
  transcriptText: string,
): Promise<{ sessionId: string; alreadyDone: boolean }> {
  // Idempotency: check existing
  const { data: existing } = await supabase
    .from('therapai_sessions')
    .select('id, status')
    .eq('recall_bot_id', recallBotId)
    .maybeSingle();

  if (existing && existing.status === 'done') {
    return { sessionId: existing.id, alreadyDone: true };
  }

  if (existing) {
    await supabase
      .from('therapai_sessions')
      .update({ status: 'processing', transcript_text: transcriptText, session_date: sessionDate })
      .eq('id', existing.id);
    return { sessionId: existing.id, alreadyDone: false };
  }

  const { data: inserted, error } = await supabase
    .from('therapai_sessions')
    .insert({
      therapist_id: therapistId,
      session_date: sessionDate,
      transcript_text: transcriptText,
      status: 'processing',
      recall_bot_id: recallBotId,
    })
    .select('id')
    .single();
  if (error || !inserted) {
    // Race: another webhook beat us. Lookup again.
    const { data: race } = await supabase
      .from('therapai_sessions')
      .select('id')
      .eq('recall_bot_id', recallBotId)
      .single();
    if (race) return { sessionId: race.id, alreadyDone: false };
    throw new Error(`recall_session_insert_failed: ${error?.message ?? 'unknown'}`);
  }
  return { sessionId: inserted.id, alreadyDone: false };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!RECALL_WEBHOOK_SECRET || !RECALL_API_KEY) {
    return NextResponse.json({ error: 'recall_env_missing' }, { status: 503 });
  }

  const rawBody = await req.text();
  if (!verifySignature(req, rawBody)) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }

  let payload: RecallWebhookPayload;
  try { payload = JSON.parse(rawBody) as RecallWebhookPayload; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  // We only ingest transcript.done. Acknowledge everything else 200 so Recall doesn't retry.
  if (payload.event !== 'transcript.done') {
    return NextResponse.json({ ok: true, ignored: payload.event });
  }

  const botId = payload.data.bot?.id;
  if (!botId) {
    return NextResponse.json({ error: 'missing_bot_id' }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Fetch bot record (gives us metadata + transcript URL)
  let bot: RecallBotResponse;
  try { bot = await fetchBot(botId); }
  catch (err) {
    return NextResponse.json({ error: 'fetch_bot_failed', message: (err as Error).message }, { status: 502 });
  }

  const downloadUrl = bot.media_shortcuts?.transcript?.data?.download_url;
  if (!downloadUrl) {
    return NextResponse.json({ error: 'no_transcript_download_url', botId }, { status: 422 });
  }

  // 2. Fetch transcript segments
  let segments: RecallTranscriptSegment[];
  try { segments = await fetchTranscriptSegments(downloadUrl); }
  catch (err) {
    return NextResponse.json({ error: 'fetch_transcript_failed', message: (err as Error).message }, { status: 502 });
  }
  const transcriptText = flattenSegments(segments);

  // 3. Resolve therapist
  const therapistId = await resolveTherapistId(supabase, bot);

  // 4. Upsert session row (recall_bot_id idempotency)
  const sessionDate = normalizeSessionDate(bot.recording?.completed_at ?? bot.recording?.started_at);
  let sessionResult: { sessionId: string; alreadyDone: boolean };
  try {
    sessionResult = await upsertProcessingSession(supabase, therapistId, botId, sessionDate, transcriptText);
  } catch (err) {
    return NextResponse.json({ error: 'session_upsert_failed', message: (err as Error).message }, { status: 500 });
  }
  if (sessionResult.alreadyDone) {
    return NextResponse.json({ ok: true, status: 'already_processed', sessionId: sessionResult.sessionId });
  }

  // 5. Identify patient — title-first heuristic, fallback to dominant speaker
  const meta: MeetingMetadata = {
    title: bot.meeting_metadata?.title ?? null,
    sessionDate,
    durationMin: 0, // Recall doesn't expose duration on bot resource directly; compute later if needed
    participants: (bot.meeting_participants ?? []).map((p) => p.email ?? p.name ?? '').filter(Boolean),
    summaryOverview: null,
  };

  // Compute duration roughly from last segment end_timestamp
  const lastSeg = segments[segments.length - 1];
  if (lastSeg?.words?.length) {
    const last = lastSeg.words[lastSeg.words.length - 1];
    if (last?.end_timestamp?.relative) {
      meta.durationMin = last.end_timestamp.relative / 60;
    }
  }

  const candidateName = identifyPatient({
    title: meta.title,
    speakers: speakerCounts(segments),
  });

  let patientId: string | null = null;
  if (candidateName) {
    patientId = await matchOrNullPatient(supabase, therapistId, candidateName);
  }

  if (!patientId) {
    await supabase
      .from('therapai_sessions')
      .update({ status: 'unidentified', patient_id: null })
      .eq('id', sessionResult.sessionId);
    return NextResponse.json({
      ok: true,
      status: 'unidentified',
      sessionId: sessionResult.sessionId,
      candidateName: candidateName ?? null,
    });
  }

  // 6. Run full analysis pipeline
  const ctx: IngestContext = {
    supabase,
    therapistId,
    sessionId: sessionResult.sessionId,
    patientId,
    meta,
    transcriptText,
  };

  try {
    const result = await runFullAnalysisPipeline(ctx);
    return NextResponse.json({
      ok: true,
      botId,
      sessionId: ctx.sessionId,
      patientId,
      title: meta.title,
      platform: bot.meeting_url?.platform ?? null,
      analysisModel: result.molarModel,
      sessionNumber: result.sessionNumber,
      molecular: result.molecularStatus,
      molecularEvents: result.molecularEvents,
      longitudinal: result.longitudinalStatus,
    });
  } catch (err) {
    if (err instanceof ProviderError) {
      await supabase
        .from('therapai_sessions')
        .update({ status: 'failed_retry_pending', model_used: (err as Error).message.slice(0, 200) })
        .eq('id', ctx.sessionId);
      return NextResponse.json({
        ok: true,
        status: 'failed_retry_pending',
        sessionId: ctx.sessionId,
        message: 'Both providers exhausted; queued for offline rescue.',
      });
    }
    await supabase
      .from('therapai_sessions')
      .update({ status: 'failed', model_used: (err as Error).message.slice(0, 200) })
      .eq('id', ctx.sessionId);
    return NextResponse.json({
      ok: true,
      status: 'failed',
      sessionId: ctx.sessionId,
      message: (err as Error).message,
    });
  }
}
