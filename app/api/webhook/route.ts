// app/api/webhook/route.ts
//
// TherapAI — Fireflies webhook handler.
// Locked decisions: D9, D10, D11, D12 (DECISIONS.md). Spec: WEBHOOK_SPEC.md.
//
// Flow per request:
//   1. Verify shared-secret (X-Fireflies-Secret header or ?secret= param).
//   2. Parse payload, extract Fireflies transcript ID.
//   3. Idempotency check: if fireflies_id already done, no-op 200.
//   4. Insert/upsert session row (status='processing').
//   5. Fetch full transcript via Fireflies GraphQL.
//   6. Resolve owning therapist (host_email → therapai_therapists.email match).
//   7. Identify patient (title-first; fallback to most-frequent non-operator speaker).
//   8. Match against existing therapai_patients; on no match → status='unidentified'.
//   9. Run full analysis pipeline via lib/ingest.ts (molar → save → done →
//      molecular → assertions → longitudinal).
//  10. ProviderError (both Claude+OpenAI exhausted) → status='failed_retry_pending'.
//
// 2026-05-14 fold-in: shared analysis pipeline lives in lib/ingest.ts. This
// handler now contains only Fireflies-specific code (auth, GraphQL fetch,
// sentence flattening, fireflies_id idempotency, therapist resolution by
// Fireflies payload shape). The molar/molecular/assertion/longitudinal
// logic that used to live inline (~700 lines) is gone — runFullAnalysisPipeline
// owns it.

import { NextRequest, NextResponse } from 'next/server';
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

// ─── Env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const FIREFLIES_API_KEY = process.env.FIREFLIES_API_KEY!;
const FIREFLIES_WEBHOOK_SECRET = process.env.FIREFLIES_WEBHOOK_SECRET!;

// Multi-tenant pivot 2026-05-13 + strict-mode cleanup 2026-05-15:
// Webhook resolves the owning therapist by matching the Fireflies
// host_email/organizer_email/participants against therapai_therapists.email.
//
// THERAPAI_FALLBACK_THERAPIST_ID is OPTIONAL. When set, unmatched transcripts
// route to that tenant (legacy single-tenant behavior, useful for staging).
// When UNSET (recommended for multi-tenant production), unmatched transcripts
// return HTTP 422 instead of silently landing in a wrong tenant.
const FALLBACK_THERAPIST_ID: string | null =
  process.env.THERAPAI_FALLBACK_THERAPIST_ID || null;

// ─── Types ────────────────────────────────────────────────────────────────────
interface FirefliesSentence {
  speaker_name: string;
  text: string;
  start_time: number;
}

interface FirefliesTranscript {
  id: string;
  title: string | null;
  date: number | string;
  duration: number;
  participants: string[];
  host_email: string | null;
  organizer_email: string | null;
  summary: { overview: string | null } | null;
  sentences: FirefliesSentence[];
}

interface FirefliesWebhookPayload {
  meetingId?: string;
  meeting_id?: string;
  transcriptId?: string;
  eventType?: string;
  event?: string;
}

// ─── Session-row helpers (Fireflies-specific: fireflies_id idempotency) ──────

interface MarkResult {
  ok: boolean;
  verified: boolean;
  sessionId?: string;
  error?: string;
}

async function resolveTherapistId(
  supabase: SupabaseClient,
  transcript: FirefliesTranscript,
): Promise<string | null> {
  const candidates = [
    transcript.host_email,
    transcript.organizer_email,
    ...(transcript.participants ?? []),
  ]
    .map((e) => (e ?? '').toLowerCase().trim())
    .filter((e) => e.length > 0 && e.includes('@'));
  if (candidates.length === 0) return FALLBACK_THERAPIST_ID;

  const { data } = await supabase
    .from('therapai_therapists')
    .select('id, email')
    .in('email', candidates)
    .limit(candidates.length);
  if (!data || data.length === 0) return FALLBACK_THERAPIST_ID;

  // Prefer host/organizer match over generic participant match.
  const byEmail = new Map<string, string>(data.map((r) => [r.email.toLowerCase(), r.id]));
  for (const email of candidates) {
    const hit = byEmail.get(email);
    if (hit) return hit;
  }
  return FALLBACK_THERAPIST_ID;
}

async function fetchFirefliesTranscript(id: string): Promise<FirefliesTranscript> {
  const query = `query Transcript($id: String!) {
    transcript(id: $id) {
      id title date duration participants host_email organizer_email
      summary { overview }
      sentences { speaker_name text start_time }
    }
  }`;
  const res = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FIREFLIES_API_KEY}` },
    body: JSON.stringify({ query, variables: { id } }),
  });
  if (!res.ok) throw new Error(`fireflies_http_${res.status}`);
  const json = (await res.json()) as { data?: { transcript?: FirefliesTranscript }; errors?: unknown };
  if (json.errors) throw new Error(`fireflies_graphql_error: ${JSON.stringify(json.errors)}`);
  if (!json.data?.transcript) throw new Error('fireflies_transcript_missing');
  return json.data.transcript;
}

async function upsertProcessingSession(
  supabase: SupabaseClient,
  therapistId: string,
  existingId: string | undefined,
  firefliesId: string,
  sessionDate: string,
  transcriptText: string,
): Promise<string> {
  if (existingId) {
    await supabase
      .from('therapai_sessions')
      .update({ status: 'processing', transcript_text: transcriptText, session_date: sessionDate })
      .eq('id', existingId);
    return existingId;
  }
  const { data, error } = await supabase
    .from('therapai_sessions')
    .insert({
      therapist_id: therapistId,
      session_date: sessionDate,
      transcript_text: transcriptText,
      status: 'processing',
      fireflies_id: firefliesId,
    })
    .select('id')
    .single();
  if (error || !data) {
    // Race: another webhook already inserted. Fetch and reuse.
    const { data: race } = await supabase
      .from('therapai_sessions')
      .select('id')
      .eq('fireflies_id', firefliesId)
      .single();
    if (race) return race.id;
    throw new Error(`session_insert_failed: ${error?.message ?? 'unknown'}`);
  }
  return data.id;
}

async function markSessionWithStatus(
  supabase: SupabaseClient,
  sessionId: string | undefined,
  firefliesId: string,
  reason: string,
  status: 'failed' | 'failed_retry_pending',
): Promise<MarkResult> {
  if (sessionId) {
    const { error } = await supabase
      .from('therapai_sessions')
      .update({ status, model_used: reason.slice(0, 200) })
      .eq('id', sessionId);
    if (error) {
      console.error(`[webhook][supabase] markSession(${status}) update failed`, { sessionId, firefliesId, error });
      return { ok: false, verified: false, sessionId, error: error.message };
    }
    const verified = await verifyRowStatus(supabase, sessionId, status);
    return { ok: true, verified, sessionId };
  }
  // Upsert path — no existing sessionId. Capture the row id after upsert.
  // Strict-mode: skip the upsert when no fallback tenant is configured. The
  // error-marker row would be orphaned without a tenant anyway, and we don't
  // want failed Fireflies fetches to bleed into a random tenant's view.
  if (!FALLBACK_THERAPIST_ID) {
    console.warn('[webhook] markSession skipped — no fallback tenant configured', { firefliesId, status, reason });
    return { ok: true, verified: false, error: 'tenant_unresolved_skip_marker' };
  }
  const { data, error } = await supabase
    .from('therapai_sessions')
    .upsert(
      {
        therapist_id: FALLBACK_THERAPIST_ID,
        session_date: new Date().toISOString().slice(0, 10),
        status,
        fireflies_id: firefliesId,
        model_used: reason.slice(0, 200),
      },
      { onConflict: 'fireflies_id' },
    )
    .select('id')
    .maybeSingle();
  if (error) {
    console.error(`[webhook][supabase] markSession(${status}) upsert failed`, { firefliesId, error });
    return { ok: false, verified: false, error: error.message };
  }
  if (!data?.id) {
    const { data: lookup } = await supabase
      .from('therapai_sessions')
      .select('id')
      .eq('fireflies_id', firefliesId)
      .maybeSingle();
    if (!lookup?.id) return { ok: false, verified: false, error: 'row_not_found_post_upsert' };
    const verified = await verifyRowStatus(supabase, lookup.id, status);
    return { ok: true, verified, sessionId: lookup.id };
  }
  const verified = await verifyRowStatus(supabase, data.id, status);
  return { ok: true, verified, sessionId: data.id };
}

async function markSessionFailed(
  supabase: SupabaseClient,
  sessionId: string | undefined,
  firefliesId: string,
  reason: string,
): Promise<MarkResult> {
  return markSessionWithStatus(supabase, sessionId, firefliesId, reason, 'failed');
}

async function markSessionFailedRetryPending(
  supabase: SupabaseClient,
  sessionId: string | undefined,
  firefliesId: string,
  reason: string,
): Promise<MarkResult> {
  return markSessionWithStatus(supabase, sessionId, firefliesId, reason, 'failed_retry_pending');
}

async function verifyRowStatus(supabase: SupabaseClient, sessionId: string, expected: string): Promise<boolean> {
  const { data } = await supabase
    .from('therapai_sessions')
    .select('status')
    .eq('id', sessionId)
    .maybeSingle();
  return data?.status === expected;
}

// ─── Transcript helpers ───────────────────────────────────────────────────────

function sentencesToTranscriptText(sentences: FirefliesSentence[]): string {
  return sentences
    .map((s) => {
      const ts = formatTimestamp(s.start_time);
      return `[${ts}] ${s.speaker_name}: ${s.text}`;
    })
    .join('\n');
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function normalizeSessionDate(input: number | string): string {
  if (typeof input === 'number') return new Date(input).toISOString().slice(0, 10);
  const d = new Date(input);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function speakerCountsFromSentences(sentences: FirefliesSentence[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of sentences) {
    const name = (s.speaker_name ?? '').trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

// ─── Webhook entry point ──────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Authenticate via shared secret (HMAC verification is Phase 2 per D7).
  const providedQuery = req.nextUrl.searchParams.get('secret');
  const providedHeader = req.headers.get('x-fireflies-secret');
  const provided = providedQuery ?? providedHeader;
  if (!provided || provided !== FIREFLIES_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse payload.
  let payload: FirefliesWebhookPayload;
  try { payload = (await req.json()) as FirefliesWebhookPayload; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const firefliesId = payload.transcriptId ?? payload.meetingId ?? payload.meeting_id;
  if (!firefliesId) {
    return NextResponse.json({ error: 'missing_transcript_id' }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 3. Idempotency: short-circuit if fireflies_id already done.
  const { data: existing } = await supabase
    .from('therapai_sessions')
    .select('id, status')
    .eq('fireflies_id', firefliesId)
    .maybeSingle();
  if (existing && existing.status === 'done') {
    return NextResponse.json({ ok: true, status: 'already_processed', sessionId: existing.id });
  }

  // 4. Fetch full transcript from Fireflies.
  let transcript: FirefliesTranscript;
  try { transcript = await fetchFirefliesTranscript(firefliesId); }
  catch (err) {
    const mark = await markSessionFailed(supabase, existing?.id, firefliesId, `fireflies_fetch_failed: ${(err as Error).message}`);
    return NextResponse.json({ ok: true, status: 'failed', reason: 'fireflies_fetch', save: mark });
  }

  // 5. Resolve therapist (multi-tenant). Strict mode: if no fallback configured
  // and no email match found, refuse the webhook with 422 rather than silently
  // landing the transcript in a wrong tenant.
  const therapistId = await resolveTherapistId(supabase, transcript);
  if (!therapistId) {
    console.warn('[webhook] tenant_unresolved — no email match, no fallback configured', {
      firefliesId,
      host_email: transcript.host_email,
      organizer_email: transcript.organizer_email,
      participant_count: (transcript.participants ?? []).length,
    });
    return NextResponse.json({
      ok: false,
      error: 'tenant_unresolved',
      message: 'No therapai_therapists row matched the meeting participants and THERAPAI_FALLBACK_THERAPIST_ID is not set. Either invite this clinician (insert into therapai_therapists) or set the fallback env var.',
    }, { status: 422 });
  }
  console.log('[webhook] therapist resolved', { firefliesId, therapistId });

  // 6. Upsert session row.
  const sessionDate = normalizeSessionDate(transcript.date);
  const transcriptText = sentencesToTranscriptText(transcript.sentences);
  const sessionId = await upsertProcessingSession(
    supabase, therapistId, existing?.id, firefliesId, sessionDate, transcriptText,
  );

  // 7. Identify patient via shared lib.
  const candidateName = identifyPatient({
    title: transcript.title,
    speakers: speakerCountsFromSentences(transcript.sentences),
  });
  let patientId: string | null = null;
  if (candidateName) {
    patientId = await matchOrNullPatient(supabase, therapistId, candidateName);
  }

  if (!patientId) {
    await supabase
      .from('therapai_sessions')
      .update({ status: 'unidentified', patient_id: null })
      .eq('id', sessionId);
    return NextResponse.json({
      ok: true,
      status: 'unidentified',
      sessionId,
      detectedName: candidateName ?? null,
    });
  }

  // 8. Run shared analysis pipeline.
  const meta: MeetingMetadata = {
    title: transcript.title,
    sessionDate,
    durationMin: transcript.duration,
    participants: transcript.participants ?? [],
    summaryOverview: transcript.summary?.overview ?? null,
  };
  const ctx: IngestContext = {
    supabase,
    therapistId,
    sessionId,
    patientId,
    meta,
    transcriptText,
  };

  try {
    const result = await runFullAnalysisPipeline(ctx);
    return NextResponse.json({
      ok: true,
      status: 'done',
      sessionId,
      patientId,
      model: result.molarModel,
      sessionNumber: result.sessionNumber,
      molecular: result.molecularStatus,
      molecularEvents: result.molecularEvents,
      longitudinal: result.longitudinalStatus,
    });
  } catch (err) {
    if (err instanceof ProviderError) {
      const mark = await markSessionFailedRetryPending(supabase, sessionId, firefliesId, `analysis_failed: ${(err as Error).message}`);
      return NextResponse.json({ ok: true, status: 'failed_retry_pending', reason: 'analysis_provider', save: mark });
    }
    const mark = await markSessionFailed(supabase, sessionId, firefliesId, `analysis_failed: ${(err as Error).message}`);
    return NextResponse.json({ ok: true, status: 'failed', reason: 'analysis', save: mark });
  }
}
