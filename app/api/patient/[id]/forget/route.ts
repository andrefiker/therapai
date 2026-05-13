// app/api/patient/[id]/forget/route.ts
//
// LGPD Art. 18, VI (anonimização, bloqueio ou eliminação) + Art. 5, X
// (eliminação dos dados pessoais tratados com consentimento do titular).
//
// Hard-deletes one patient's clinical footprint across all therapai_* tables.
// Owner-only (the clinician-controller, acting on the patient/data-subject's
// request — TherapAI is operator, not controller). Service-role bypass needed
// because the cascade order requires us to delete sessions BEFORE the patient
// row (session.patient_id is SET NULL on patient delete, which would orphan
// transcript_text — that's the worst possible outcome for a "forget" request).
//
// Cascade order (verified against pg_constraint 2026-05-13):
//   1. DELETE therapai_sessions WHERE patient_id = X
//        → CASCADEs therapai_analyses (session_id) + therapai_molecular_analyses (session_id)
//   2. DELETE therapai_molecular_analyses WHERE patient_id = X
//        → catches any orphans not tied to a session (defensive — should be none)
//   3. DELETE therapai_patients WHERE id = X
//        → CASCADEs therapai_case_queries (patient_id) + therapai_longitudinal (patient_id)
//           + therapai_patient_memory_assertions (patient_id)
//
// Audit row written before AND after deletion so the action is traceable even
// if the cascade fails partway. ISA: therapai-lgpd-compliance, F11 / ISC-19.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer, supabaseAdmin } from '@/lib/supabase';
import { getTherapist } from '@/lib/viewer';
import { audit, extractClientIp } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: patientId } = await params;
  if (!patientId) return NextResponse.json({ error: 'missing_patient_id' }, { status: 400 });

  const authClient = await createSupabaseServer();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const therapist = await getTherapist(authClient, user);
  if (!therapist) {
    return NextResponse.json({ error: 'forbidden', message: 'Tenant não provisionado.' }, { status: 403 });
  }

  // Confirm the patient belongs to this therapist before deleting anything.
  // We use authClient (RLS-aware) for the lookup — if RLS hides the row, the
  // delete won't run.
  const { data: patient, error: lookupErr } = await authClient
    .from('therapai_patients')
    .select('id, name, therapist_id')
    .eq('id', patientId)
    .maybeSingle();

  if (lookupErr) {
    console.error('[forget] patient lookup failed', { patientId, err: lookupErr.message });
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!patient) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Audit BEFORE delete — traceability of intent even if delete fails partway.
  audit(authClient, user.id, {
    action: 'art18_patient_forget_started',
    target_table: 'therapai_patients',
    target_row_id: patientId,
    context: { patient_name_at_delete: patient.name },
    ip: extractClientIp(req.headers),
    user_agent: req.headers.get('user-agent'),
  });

  // Cascade order matters — see comment block at file top.
  const counts: Record<string, number | string> = {};

  // Step 1: sessions (cascades analyses + molecular by session_id)
  const sessionsDel = await supabaseAdmin
    .from('therapai_sessions')
    .delete()
    .eq('patient_id', patientId)
    .select('id');
  counts.sessions = sessionsDel.error ? `error:${sessionsDel.error.message}` : (sessionsDel.data?.length ?? 0);

  // Step 2: molecular_analyses (defensive — catch any not tied to a deleted session)
  const molDel = await supabaseAdmin
    .from('therapai_molecular_analyses')
    .delete()
    .eq('patient_id', patientId)
    .select('id');
  counts.molecular_analyses = molDel.error ? `error:${molDel.error.message}` : (molDel.data?.length ?? 0);

  // Step 3: the patient itself (cascades case_queries, longitudinal, memory_assertions)
  const patientDel = await supabaseAdmin
    .from('therapai_patients')
    .delete()
    .eq('id', patientId)
    .select('id');
  counts.patient = patientDel.error ? `error:${patientDel.error.message}` : (patientDel.data?.length ?? 0);

  // Audit AFTER delete with counts of removed rows.
  audit(authClient, user.id, {
    action: 'art18_patient_forget_completed',
    target_table: 'therapai_patients',
    target_row_id: patientId,
    context: { counts, patient_name_at_delete: patient.name },
    ip: extractClientIp(req.headers),
    user_agent: req.headers.get('user-agent'),
  });

  return NextResponse.json({
    ok: true,
    patient_id: patientId,
    counts,
    legal_basis: 'LGPD art. 18, VI — direito à eliminação',
  });
}
