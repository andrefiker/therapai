#!/usr/bin/env bun
//
// One-shot smoke test: launch a Recall.ai bot at a meeting URL, stamp it
// with a therapai_therapist_id in metadata, and print the bot id + how to
// watch for the analysis to land.
//
// Usage:
//   bun scripts/recall-smoke.ts <meeting_url> [therapist_id]
//
// Requires (read from shell env or .env.local — bun loads .env files
// automatically when --env-file is passed; otherwise export RECALL_API_KEY
// before running):
//   RECALL_API_KEY        workspace key from Recall dashboard
//   RECALL_API_BASE       optional, default https://us-west-2.recall.ai/api/v1
//
// Default therapist_id is André's tenant. Override for tester runs.

import { createBotForTherapist, RecallApiError } from '../lib/recall';

const ANDRE_THERAPIST_ID = '60fdab49-c4dd-45cc-9e2b-51bec3504d35';

async function main() {
  const meetingUrl = process.argv[2];
  const therapistId = process.argv[3] ?? ANDRE_THERAPIST_ID;

  if (!meetingUrl) {
    console.error('usage: bun scripts/recall-smoke.ts <meeting_url> [therapist_id]');
    process.exit(2);
  }

  if (!process.env.RECALL_API_KEY) {
    console.error('RECALL_API_KEY not set. Either export it or run with:');
    console.error('  bun --env-file=.env.local scripts/recall-smoke.ts <meeting_url>');
    process.exit(2);
  }

  console.log(`[recall-smoke] launching bot`);
  console.log(`  meeting_url:  ${meetingUrl}`);
  console.log(`  therapist_id: ${therapistId}`);

  try {
    const bot = await createBotForTherapist({
      meetingUrl,
      therapistId,
      botName: 'TherapAI · Smoke Test',
      extraMetadata: { source: 'recall-smoke.ts' },
    });

    console.log('');
    console.log('[recall-smoke] bot created');
    console.log(`  bot_id:   ${bot.id}`);
    console.log(`  status:   ${bot.status ?? '(none — Recall returns null on initial create)'}`);
    console.log(`  platform: ${bot.meeting_url?.platform ?? '(unknown)'}`);
    console.log(`  meeting:  ${bot.meeting_url?.meeting_id ?? '(unknown)'}`);
    console.log('');
    console.log('Next:');
    console.log('  1. Bot should join the meeting within ~30s. Verify in the meeting UI.');
    console.log('  2. End the meeting (or leave it >5min) so Recall finalizes the transcript.');
    console.log('  3. transcript.done webhook fires → POST to /api/recall/webhook.');
    console.log('  4. Watch the session row appear:');
    console.log('');
    console.log(`     PGPASSWORD=$SUPABASE_DB_PASSWORD psql -h db.awumxiqawrzkjvjtdscf.supabase.co \\`);
    console.log(`       -U postgres -d postgres -c "select id, status, session_date, created_at \\`);
    console.log(`       from therapai_sessions where recall_bot_id = '${bot.id}';"`);
    console.log('');
    console.log('  Or via Supabase MCP / SQL editor:');
    console.log(`     select id, status, session_date, created_at from therapai_sessions where recall_bot_id = '${bot.id}';`);
    console.log('');
    console.log('  5. If status flips to "processing" → "done", the M2 smoke flight is GREEN.');
  } catch (err) {
    if (err instanceof RecallApiError) {
      console.error(`[recall-smoke] Recall API error ${err.status}:`);
      console.error(err.body.slice(0, 500));
      process.exit(1);
    }
    console.error('[recall-smoke] unexpected error:', (err as Error).message);
    process.exit(1);
  }
}

main();
