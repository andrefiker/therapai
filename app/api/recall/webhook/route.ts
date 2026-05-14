// app/api/recall/webhook/route.ts
//
// Recall.ai webhook handler — receives meeting-recording lifecycle events,
// fetches the transcript when ready, and routes into the existing TherapAI
// analysis pipeline. Parallel ingest path to the legacy Fireflies handler
// at /api/webhook.
//
// ISA: therapai-lgpd-compliance / RECALL pillar (milestone 3 of 6).
//
// Webhook contract (per docs.recall.ai/docs/recording-webhooks +
// docs.recall.ai/docs/authenticating-requests-from-recallai):
// - Headers: webhook-id, webhook-timestamp, webhook-signature ("v1,<b64>")
// - Signed string: `{webhook-id}.{webhook-timestamp}.{raw body}`
// - Algorithm: HMAC-SHA256, key = base64-decoded(secret without "whsec_" prefix)
// - Event filter: only `transcript.done` triggers a transcript fetch + ingest.
// - Idempotency key: data.bot.id (one analysis per bot/meeting).
//
// Env required (set in Vercel before this route can authenticate):
// - RECALL_WEBHOOK_SECRET  ("whsec_..." from Recall dashboard Developers > API Keys & Secrets)
// - RECALL_API_KEY         (workspace API key from same dashboard)
// - RECALL_API_BASE        (optional; default https://us-east-1.recall.ai/api/v1)

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const maxDuration = 300;

const RECALL_WEBHOOK_SECRET = process.env.RECALL_WEBHOOK_SECRET ?? '';
const RECALL_API_KEY = process.env.RECALL_API_KEY ?? '';
// Region-scoped Recall API base. Defaults to us-west-2 (André's workspace);
// override via RECALL_API_BASE env var if the operator workspace lives elsewhere
// (us-east-1, eu-central-1, ap-northeast-1).
const RECALL_API_BASE = process.env.RECALL_API_BASE ?? 'https://us-west-2.recall.ai/api/v1';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecallWebhookPayload {
  event: string;
  data: {
    data?: { code?: string; sub_code?: string | null; updated_at?: string };
    transcript?: { id: string; metadata?: Record<string, unknown> };
    recording?: { id: string; metadata?: Record<string, unknown> };
    bot?: { id: string; metadata?: Record<string, unknown> };
  };
}

interface RecallBotResponse {
  id: string;
  meeting_url?: { meeting_id?: string; platform?: string };
  meeting_metadata?: { title?: string | null };
  media_shortcuts?: {
    transcript?: {
      data?: {
        download_url?: string;
      };
    };
  };
  // … bot has many more fields; only naming what we use.
}

interface RecallTranscriptSegment {
  speaker: string | null;
  words: Array<{ text: string; start_timestamp: { relative: number }; end_timestamp: { relative: number } }>;
}

// ─── Signature verification (Svix-format) ─────────────────────────────────────

// Svix-format signature verification per Recall webhook docs.
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

async function fetchTranscriptText(downloadUrl: string): Promise<string> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`recall transcript download failed: ${res.status}`);
  const segments = (await res.json()) as RecallTranscriptSegment[];
  // Flatten Recall's per-word segments into "Speaker: text" lines, similar shape to Fireflies output
  return segments
    .map((s) => {
      const text = s.words.map((w) => w.text).join(' ').trim();
      return text ? `${s.speaker ?? 'Speaker'}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
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
  try {
    payload = JSON.parse(rawBody) as RecallWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // We only act on transcript-ready events. Acknowledge everything else with 200
  // so Recall doesn't retry (per their webhook reliability docs).
  if (payload.event !== 'transcript.done') {
    return NextResponse.json({ ok: true, ignored: payload.event });
  }

  const botId = payload.data.bot?.id;
  if (!botId) {
    return NextResponse.json({ error: 'missing_bot_id' }, { status: 400 });
  }

  try {
    const bot = await fetchBot(botId);
    const downloadUrl = bot.media_shortcuts?.transcript?.data?.download_url;
    if (!downloadUrl) {
      return NextResponse.json({ error: 'no_transcript_download_url', botId }, { status: 422 });
    }
    const transcriptText = await fetchTranscriptText(downloadUrl);

    // TODO (RECALL milestone 4): branch on therapai_therapists.ingest_source.
    // For now, this route exists but does NOT yet write to therapai_sessions
    // or invoke the analysis pipeline. That wiring lands once ingest_source
    // is added to the schema and we decide whether to mirror Fireflies' flow
    // (idempotency on bot.id → insert processing row → run molar → save analysis
    // → rebuild longitudinal) or run a leaner first-pass.
    //
    // Until then this handler validates signature + fetches transcript + returns
    // a confirmation, which is the minimum to verify the end-to-end Recall plumbing
    // works against your sandbox.

    console.log('[recall][webhook] transcript fetched', {
      botId,
      title: bot.meeting_metadata?.title ?? null,
      platform: bot.meeting_url?.platform ?? null,
      transcriptCharLen: transcriptText.length,
    });

    return NextResponse.json({
      ok: true,
      botId,
      title: bot.meeting_metadata?.title ?? null,
      platform: bot.meeting_url?.platform ?? null,
      transcriptCharLen: transcriptText.length,
      ingest_status: 'fetched_but_not_persisted_pending_milestone_4',
    });
  } catch (err) {
    console.error('[recall][webhook] fetch+process failed', { botId, err: (err as Error).message });
    return NextResponse.json({ error: 'fetch_failed', message: (err as Error).message }, { status: 502 });
  }
}
