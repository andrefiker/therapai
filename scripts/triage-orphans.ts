#!/usr/bin/env bun
//
// Triage script for unidentified Fireflies-sourced sessions.
//
// For each session in `therapai_sessions` with status='unidentified' and
// no recall_bot_id, extract speaker labels from the transcript, match
// them against the therapist's patient list, and classify as:
//   - AUTO_MATCH      : single clear patient match in the speaker labels
//   - NEEDS_REVIEW    : ambiguous / no clear match
//   - DELETE_CANDIDATE: very short transcripts (< 1000 chars) with no patient signal
//
// Output: scripts/orphans-triage-report.json (and a printed summary).
//
// Usage:
//   bun --env-file=.env.local scripts/triage-orphans.ts
//
// No DB writes from this script — it's read-only. Apply step is separate.

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const ANDRE_THERAPIST_ID = '60fdab49-c4dd-45cc-9e2b-51bec3504d35';
const THERAPIST_LABELS = ['andré fiker', 'andre fiker', 'andré', 'andre'];

interface Orphan {
  id: string;
  transcript_text: string;
  created_at: string;
}

interface Patient {
  id: string;
  name: string;
}

interface Proposal {
  session_id: string;
  chars: number;
  created_at: string;
  speaker_labels: string[];
  candidate_patient_id: string | null;
  candidate_patient_name: string | null;
  classification: 'AUTO_MATCH' | 'NEEDS_REVIEW' | 'DELETE_CANDIDATE';
  reason: string;
  opening: string;
}

function extractSpeakerLabels(transcript: string): string[] {
  // Lines look like:  "[00:09] Joyce De Almeida: hello"  or  "[00:09] Speaker 1: hello"
  const matches = transcript.matchAll(/\][^\]]*?\]\s*([^:\n]{1,80}?):/g);
  const labels = new Set<string>();
  for (const m of matches) labels.add(m[1].trim());
  return [...labels];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchPatient(speakerLabels: string[], patients: Patient[]): Patient | { ambiguous: true; candidates: Patient[] } | null {
  const nonTherapistLabels = speakerLabels
    .filter((l) => {
      const n = normalize(l);
      if (THERAPIST_LABELS.includes(n)) return false;
      if (/^speaker\s*\d+$/i.test(l.trim())) return false;
      if (n.length < 2) return false;
      return true;
    })
    .map(normalize);

  if (nonTherapistLabels.length === 0) return null;

  const hits: Patient[] = [];
  for (const p of patients) {
    const pn = normalize(p.name);
    const pnTokens = pn.split(' ').filter((t) => t.length >= 3);
    for (const label of nonTherapistLabels) {
      // Exact normalized match
      if (label === pn) { hits.push(p); break; }
      // Label fully contains patient name (e.g. "Joyce De Almeida" label, patient "Joyce Paiva")
      // → require token-level overlap of at least 2 tokens or first+last token match
      const labelTokens = label.split(' ').filter((t) => t.length >= 3);
      const overlap = pnTokens.filter((t) => labelTokens.includes(t));
      if (overlap.length >= 2) { hits.push(p); break; }
      // Single-token patient name (e.g. "Ana", "Bia") - require exact token-equal label
      if (pnTokens.length === 1 && labelTokens.length === 1 && pnTokens[0] === labelTokens[0]) {
        hits.push(p);
        break;
      }
    }
  }

  const unique = Array.from(new Map(hits.map((p) => [p.id, p])).values());
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];
  return { ambiguous: true, candidates: unique };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(2);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log('[triage] loading patients...');
  const { data: patients, error: pErr } = await supabase
    .from('therapai_patients')
    .select('id, name')
    .eq('therapist_id', ANDRE_THERAPIST_ID);
  if (pErr || !patients) throw new Error(`patient fetch: ${pErr?.message}`);
  console.log(`[triage] ${patients.length} patients in tenant`);

  console.log('[triage] loading orphan sessions...');
  const { data: orphans, error: oErr } = await supabase
    .from('therapai_sessions')
    .select('id, transcript_text, created_at')
    .eq('therapist_id', ANDRE_THERAPIST_ID)
    .eq('status', 'unidentified')
    .is('recall_bot_id', null);
  if (oErr || !orphans) throw new Error(`orphan fetch: ${oErr?.message}`);
  console.log(`[triage] ${orphans.length} orphans to classify`);

  const proposals: Proposal[] = [];
  for (const o of orphans as Orphan[]) {
    const transcript = o.transcript_text ?? '';
    const labels = extractSpeakerLabels(transcript);
    const match = matchPatient(labels, patients);

    let classification: Proposal['classification'];
    let reason: string;
    let candidateId: string | null = null;
    let candidateName: string | null = null;

    if (transcript.length < 1000) {
      classification = 'DELETE_CANDIDATE';
      reason = `too short (${transcript.length} chars) — likely test/smoke/dropped audio`;
    } else if (match && 'ambiguous' in match) {
      classification = 'NEEDS_REVIEW';
      reason = `ambiguous: ${match.candidates.map((c) => c.name).join(', ')}`;
    } else if (match) {
      classification = 'AUTO_MATCH';
      reason = `speaker label matches patient "${match.name}"`;
      candidateId = match.id;
      candidateName = match.name;
    } else if (labels.every((l) => /^speaker\s*\d+$/i.test(l) || THERAPIST_LABELS.includes(normalize(l)))) {
      classification = 'NEEDS_REVIEW';
      reason = 'anonymized speakers only — manual id required';
    } else {
      classification = 'NEEDS_REVIEW';
      reason = `non-patient speaker label(s): ${labels.filter((l) => !THERAPIST_LABELS.includes(normalize(l))).join(', ')}`;
    }

    proposals.push({
      session_id: o.id,
      chars: transcript.length,
      created_at: o.created_at,
      speaker_labels: labels,
      candidate_patient_id: candidateId,
      candidate_patient_name: candidateName,
      classification,
      reason,
      opening: transcript.slice(0, 200).replace(/\n/g, ' | '),
    });
  }

  // Sort: AUTO_MATCH first (groupable), then NEEDS_REVIEW (by chars desc — biggest first), then DELETE_CANDIDATE
  const order = { AUTO_MATCH: 0, NEEDS_REVIEW: 1, DELETE_CANDIDATE: 2 };
  proposals.sort((a, b) => order[a.classification] - order[b.classification] || b.chars - a.chars);

  const counts = proposals.reduce((acc, p) => {
    acc[p.classification] = (acc[p.classification] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Group AUTO_MATCH by patient for review
  const byPatient: Record<string, number> = {};
  for (const p of proposals.filter((p) => p.classification === 'AUTO_MATCH')) {
    byPatient[p.candidate_patient_name!] = (byPatient[p.candidate_patient_name!] ?? 0) + 1;
  }

  console.log('');
  console.log('[triage] summary:');
  console.log(`  AUTO_MATCH:       ${counts.AUTO_MATCH ?? 0}`);
  console.log(`  NEEDS_REVIEW:     ${counts.NEEDS_REVIEW ?? 0}`);
  console.log(`  DELETE_CANDIDATE: ${counts.DELETE_CANDIDATE ?? 0}`);
  console.log('');
  console.log('[triage] auto-match by patient:');
  for (const [name, n] of Object.entries(byPatient).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${n}`);
  }

  const outPath = 'scripts/orphans-triage-report.json';
  writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), counts, byPatient, proposals }, null, 2));
  console.log('');
  console.log(`[triage] full report written: ${outPath}`);
}

main();
