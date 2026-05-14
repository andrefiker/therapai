// app/api/recall/launch/route.ts
//
// POST: launch a Recall bot against a meeting URL on behalf of the
// authenticated therapist. The bot is tagged with the therapist's id in
// metadata so the eventual transcript.done webhook routes the analysis
// back to the right tenant (see app/api/recall/webhook/route.ts
// resolveTherapistId priority order).

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';
import { getTherapist } from '@/lib/viewer';
import { audit, extractClientIp } from '@/lib/audit';
import { createBotForTherapist, RecallApiError } from '@/lib/recall';

export const runtime = 'nodejs';

const MEETING_URL_RE = /^https?:\/\/.+/i;

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const therapist = await getTherapist(supabase, user);
  if (!therapist) return NextResponse.json({ error: 'tenant_not_provisioned' }, { status: 403 });

  let body: { meeting_url?: string; bot_name?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const meetingUrl = (body.meeting_url ?? '').trim();
  if (!meetingUrl || !MEETING_URL_RE.test(meetingUrl)) {
    return NextResponse.json({ error: 'invalid_meeting_url', message: 'Cole o link completo da reunião (Google Meet, Zoom ou Teams).' }, { status: 400 });
  }

  try {
    const bot = await createBotForTherapist({
      meetingUrl,
      therapistId: therapist.id,
      botName: body.bot_name?.trim() || `TherapAI · ${therapist.name}`,
      extraMetadata: { therapist_email: therapist.email },
    });
    audit(supabase, user.id, {
      action: 'recall_bot_launched',
      target_table: 'therapai_sessions',
      target_row_id: bot.id,
      context: {
        bot_id: bot.id,
        platform: bot.meeting_url?.platform ?? null,
        meeting_id: bot.meeting_url?.meeting_id ?? null,
      },
      ip: extractClientIp(req.headers),
      user_agent: req.headers.get('user-agent'),
    });
    return NextResponse.json({
      ok: true,
      bot_id: bot.id,
      status: bot.status ?? 'created',
      platform: bot.meeting_url?.platform ?? null,
      message: 'Bot lançado. Ele vai entrar na reunião e enviar a transcrição quando terminar.',
    });
  } catch (err) {
    if (err instanceof RecallApiError) {
      console.error('[recall/launch] recall api error', { status: err.status, body: err.body.slice(0, 300) });
      return NextResponse.json({
        error: 'recall_api_error',
        message: `Falha ao lançar bot (HTTP ${err.status}). Verifique se o link é público e se a reunião está agendada.`,
        recall_status: err.status,
      }, { status: 502 });
    }
    console.error('[recall/launch] unexpected error', err);
    return NextResponse.json({ error: 'unexpected', message: (err as Error).message }, { status: 500 });
  }
}
