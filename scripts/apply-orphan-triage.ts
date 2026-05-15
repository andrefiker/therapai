#!/usr/bin/env bun
//
// Apply step for the orphan-triage report at /tmp/orphan-triage-report.json.
//
// Reads each proposal and (in --apply mode) executes the corresponding DB
// action:
//   AUTO_MATCH       → UPDATE patient_id + status='processing' on the session.
//                      Does NOT re-run the analysis pipeline (that's a
//                      separate step via scripts/reanalyze.ts — keeps cost
//                      under principal control).
//   DELETE_CANDIDATE → DELETE FROM therapai_sessions (and any dependent
//                      analyses / longitudinal rows by FK cascade).
//   NEEDS_REVIEW     → left untouched. Manual review required.
//
// Modes:
//   default (--dry-run) : prints what would happen, no DB writes.
//   --apply             : actually executes. Asks for confirmation if not
//                         piped (set --yes to skip confirmation).
//   --auto-match-only   : process only AUTO_MATCH rows; skip DELETE_CANDIDATE.
//   --delete-only       : process only DELETE_CANDIDATE rows; skip AUTO_MATCH.
//
// Usage:
//   bun --env-file=.env.local scripts/apply-orphan-triage.ts                     # dry run
//   bun --env-file=.env.local scripts/apply-orphan-triage.ts --apply --yes       # full apply
//   bun --env-file=.env.local scripts/apply-orphan-triage.ts --apply --auto-match-only --yes
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
// Service-role key is sensitive in Vercel and `vercel env pull` may return
// empty; copy it from another source if env is unavailable.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';

interface Proposal {
  session_id: string;
  chars: number;
  session_date?: string;
  session_date_brt?: string;
  named_speakers: string[] | null;
  classification: 'AUTO_MATCH' | 'NEEDS_REVIEW' | 'DELETE_CANDIDATE';
  reason: string;
  candidate_patient_id: string | null;
  candidate_patient_name?: string | null;
}

interface TriageReport {
  counts?: Record<string, number>;
  auto_by_patient?: Record<string, number>;
  /** Subagent output uses `rows`; script-output uses `proposals`. */
  rows?: Proposal[];
  proposals?: Proposal[];
}

const REPORT_PATH = '/tmp/orphan-triage-report.json';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    yes: args.includes('--yes') || args.includes('-y'),
    autoMatchOnly: args.includes('--auto-match-only'),
    deleteOnly: args.includes('--delete-only'),
  };
}

async function confirmInteractive(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(prompt);
  const buf = await new Promise<string>((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      data += chunk;
      if (data.includes('\n')) {
        process.stdin.removeListener('data', onData);
        resolve(data.trim());
      }
    };
    process.stdin.on('data', onData);
  });
  return buf.toLowerCase() === 'yes';
}

async function main() {
  const opts = parseArgs();

  // Env only required for --apply; dry-run is offline.
  let supabase: SupabaseClient | null = null;
  if (opts.apply) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for --apply.');
      console.error('Tip: service-role key is sensitive in Vercel; copy it from another source if env pull returns empty.');
      process.exit(2);
    }
    supabase = createClient(url, key, { auth: { persistSession: false } });
  }

  console.log(`[apply-triage] reading ${REPORT_PATH}...`);
  let report: TriageReport;
  try {
    report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  } catch (err) {
    console.error(`failed to read triage report: ${(err as Error).message}`);
    console.error('Run scripts/triage-orphans.ts first (or use the subagent path that writes /tmp/orphan-triage-report.json).');
    process.exit(2);
  }

  const proposals = report.proposals ?? report.rows ?? [];
  if (proposals.length === 0) {
    console.error('no proposals in report — nothing to do');
    process.exit(0);
  }

  const autoMatches = proposals.filter((p) => p.classification === 'AUTO_MATCH' && p.candidate_patient_id);
  const deletes = proposals.filter((p) => p.classification === 'DELETE_CANDIDATE');
  const reviews = proposals.filter((p) => p.classification === 'NEEDS_REVIEW');

  const willAutoMatch = !opts.deleteOnly;
  const willDelete = !opts.autoMatchOnly;

  console.log('');
  console.log('=== plan ===');
  console.log(`  AUTO_MATCH:        ${autoMatches.length} rows  ${willAutoMatch ? '(WILL apply)' : '(skipped — flag)'}`);
  console.log(`  DELETE_CANDIDATE:  ${deletes.length} rows  ${willDelete ? '(WILL apply)' : '(skipped — flag)'}`);
  console.log(`  NEEDS_REVIEW:     ${reviews.length} rows  (always skipped — manual review required)`);
  console.log('');

  // Show full plan
  if (willAutoMatch && autoMatches.length > 0) {
    console.log('=== AUTO_MATCH plan ===');
    const byPatient: Record<string, number> = {};
    for (const p of autoMatches) {
      const name = p.candidate_patient_name ?? p.candidate_patient_id ?? '(unknown)';
      byPatient[name] = (byPatient[name] ?? 0) + 1;
    }
    for (const [name, n] of Object.entries(byPatient).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n} → ${name}`);
    }
    console.log('');
  }

  if (willDelete && deletes.length > 0) {
    console.log('=== DELETE_CANDIDATE plan ===');
    const sizes = deletes.map((d) => d.chars).sort((a, b) => a - b);
    const zeroChar = sizes.filter((c) => c === 0).length;
    const sub100 = sizes.filter((c) => c > 0 && c < 100).length;
    const sub500 = sizes.filter((c) => c >= 100 && c < 500).length;
    const sub1000 = sizes.filter((c) => c >= 500 && c < 1000).length;
    console.log(`  ${zeroChar} zero-char`);
    console.log(`  ${sub100} 1-99 chars`);
    console.log(`  ${sub500} 100-499 chars`);
    console.log(`  ${sub1000} 500-999 chars`);
    console.log('');
  }

  if (!opts.apply) {
    console.log('=== DRY RUN — no DB changes ===');
    console.log('Re-run with --apply to execute. Add --yes to skip confirmation.');
    process.exit(0);
  }

  // Apply mode: confirm if interactive
  if (!opts.yes) {
    const ok = await confirmInteractive(
      `About to UPDATE ${willAutoMatch ? autoMatches.length : 0} sessions and DELETE ${willDelete ? deletes.length : 0} sessions in production. Type 'yes' to proceed: `,
    );
    if (!ok) {
      console.error('aborted');
      process.exit(1);
    }
  }

  console.log('');
  console.log('=== executing ===');

  const log: Array<{ session_id: string; action: string; result: 'ok' | 'error'; error?: string }> = [];

  if (willAutoMatch) {
    console.log(`[apply-triage] auto-matching ${autoMatches.length} sessions...`);
    for (const p of autoMatches) {
      const { error } = await supabase!
        .from('therapai_sessions')
        .update({ patient_id: p.candidate_patient_id, status: 'processing' })
        .eq('id', p.session_id);
      if (error) {
        console.error(`  ✗ ${p.session_id.slice(0, 8)} → ${p.candidate_patient_name}: ${error.message}`);
        log.push({ session_id: p.session_id, action: 'auto_match', result: 'error', error: error.message });
      } else {
        console.log(`  ✓ ${p.session_id.slice(0, 8)} → ${p.candidate_patient_name}`);
        log.push({ session_id: p.session_id, action: 'auto_match', result: 'ok' });
      }
    }
  }

  if (willDelete) {
    console.log('');
    console.log(`[apply-triage] deleting ${deletes.length} sessions...`);
    // Batch deletes for efficiency
    const ids = deletes.map((d) => d.session_id);
    // chunked to keep IN-clause manageable
    const CHUNK = 50;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { error } = await supabase!.from('therapai_sessions').delete().in('id', chunk);
      if (error) {
        console.error(`  ✗ chunk ${i / CHUNK + 1}: ${error.message}`);
        for (const id of chunk) log.push({ session_id: id, action: 'delete', result: 'error', error: error.message });
      } else {
        console.log(`  ✓ chunk ${i / CHUNK + 1}: deleted ${chunk.length} rows`);
        for (const id of chunk) log.push({ session_id: id, action: 'delete', result: 'ok' });
      }
    }
  }

  const summary = {
    executed_at: new Date().toISOString(),
    auto_matches_attempted: willAutoMatch ? autoMatches.length : 0,
    auto_matches_ok: log.filter((l) => l.action === 'auto_match' && l.result === 'ok').length,
    auto_matches_failed: log.filter((l) => l.action === 'auto_match' && l.result === 'error').length,
    deletes_attempted: willDelete ? deletes.length : 0,
    deletes_ok: log.filter((l) => l.action === 'delete' && l.result === 'ok').length,
    deletes_failed: log.filter((l) => l.action === 'delete' && l.result === 'error').length,
    log,
  };

  const outPath = '/tmp/orphan-triage-apply-log.json';
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log('');
  console.log('=== done ===');
  console.log(`  auto_match: ${summary.auto_matches_ok} ok / ${summary.auto_matches_failed} failed`);
  console.log(`  delete:     ${summary.deletes_ok} ok / ${summary.deletes_failed} failed`);
  console.log(`  log:        ${outPath}`);
  console.log('');
  console.log('Next: trigger analysis pipeline for the now-identified sessions:');
  console.log(`  bun --env-file=.env.local scripts/reanalyze.ts --status=processing`);
  console.log('(or whatever flag your reanalyze.ts supports for batching status=processing rows)');
}

main().catch((err) => {
  console.error('[apply-triage] fatal:', err);
  process.exit(1);
});
