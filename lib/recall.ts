// lib/recall.ts
//
// Recall.ai REST client wrapper. Currently just one operation: launch a bot
// against a meeting URL, tagged with the therapai_therapist_id metadata so
// the eventual transcript.done webhook can route the analysis to the right
// tenant.
//
// Operational model (2026-05-14 pivot): André's workspace owns the Recall
// API key and webhook subscription; testers don't have their own Recall
// accounts. Bots are launched programmatically from our backend with the
// requesting therapist's id baked into metadata. The /api/recall/webhook
// resolver checks bot.metadata.therapai_therapist_id first when an event
// arrives — making tenancy explicit at launch time instead of inferred
// from attendees later.

const RECALL_API_BASE = process.env.RECALL_API_BASE ?? 'https://us-west-2.recall.ai/api/v1';
const RECALL_API_KEY = process.env.RECALL_API_KEY ?? '';

export interface CreateBotInput {
  meetingUrl: string;
  therapistId: string;
  /** Optional human-readable label that Recall surfaces in their dashboard. */
  botName?: string;
  /** Pass-through metadata merged into bot.metadata alongside therapai_therapist_id. */
  extraMetadata?: Record<string, string>;
}

export interface CreatedBot {
  id: string;
  metadata: Record<string, unknown>;
  meeting_url?: { meeting_id?: string; platform?: string };
  status?: string | null;
}

export class RecallApiError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'RecallApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Launches a Recall bot against a meeting URL, stamping the bot with
 * therapai_therapist_id metadata. The bot will join the meeting (Google
 * Meet / Zoom / Teams), record + transcribe, and POST `transcript.done`
 * to /api/recall/webhook when ready.
 *
 * Throws RecallApiError on non-2xx; caller maps to user-facing error.
 */
export async function createBotForTherapist(input: CreateBotInput): Promise<CreatedBot> {
  if (!RECALL_API_KEY) throw new RecallApiError('RECALL_API_KEY not set', 0, '');
  if (!input.meetingUrl) throw new RecallApiError('meetingUrl required', 0, '');
  if (!input.therapistId) throw new RecallApiError('therapistId required', 0, '');

  const body = {
    meeting_url: input.meetingUrl,
    bot_name: input.botName ?? 'TherapAI',
    metadata: {
      therapai_therapist_id: input.therapistId,
      launched_at: new Date().toISOString(),
      ...(input.extraMetadata ?? {}),
    },
    // Default: have Recall transcribe automatically (via Recall's built-in pipeline).
    // If the operator workspace already has a default transcription provider,
    // this still works; Recall accepts the field and uses workspace defaults
    // when sub-fields are omitted.
    transcription_options: { provider: 'meeting_captions' },
    // We only need real-time recording; chat/recording defaults are fine.
  };

  const res = await fetch(`${RECALL_API_BASE}/bot`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${RECALL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new RecallApiError(`recall create bot failed: ${res.status}`, res.status, text);
  }
  try { return JSON.parse(text) as CreatedBot; }
  catch { throw new RecallApiError('recall create bot returned non-JSON', res.status, text); }
}
