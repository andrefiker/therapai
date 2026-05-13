// app/api/me/export/route.ts
//
// LGPD Art. 18, II (acesso) + V (portabilidade): the data subject (or the
// controller on the subject's behalf) can request a structured export of all
// personal data the operator holds. This route returns the authenticated
// clinician's full footprint in TherapAI as a JSON bundle.
//
// Scope: clinician's OWN data only — RLS-aware authClient enforces tenant
// isolation. Service-role is NOT used here.
//
// ISA: therapai-lgpd-compliance, F11 / ISC-18 (portabilidade).

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';
import { audit, extractClientIp } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // RLS scopes each query to the authenticated user's own tenant.
  const [
    therapistRes,
    patientsRes,
    sessionsRes,
    analysesRes,
    longitudinalRes,
    molecularRes,
    assertionsRes,
    queriesRes,
    auditRes,
  ] = await Promise.all([
    supabase.from('therapai_therapists').select('*'),
    supabase.from('therapai_patients').select('*'),
    supabase.from('therapai_sessions').select('*'),
    supabase.from('therapai_analyses').select('*'),
    supabase.from('therapai_longitudinal').select('*'),
    supabase.from('therapai_molecular_analyses').select('*'),
    supabase.from('therapai_patient_memory_assertions').select('*'),
    supabase.from('therapai_case_queries').select('*'),
    supabase.from('therapai_audit_log').select('*').order('created_at', { ascending: false }).limit(5000),
  ]);

  const exportBundle = {
    meta: {
      exported_at: new Date().toISOString(),
      exported_for_user_id: user.id,
      exported_for_email: user.email ?? null,
      lgpd_basis: 'Lei nº 13.709/2018, art. 18, II e V — direito de acesso e portabilidade',
      retention_notice: 'Esta exportação inclui apenas dados visíveis ao titular sob o regime RLS atual. Logs internos de operação podem permanecer no provedor de hospedagem por períodos curtos para fins de segurança.',
      format_version: 1,
    },
    therapist: therapistRes.data ?? [],
    patients: patientsRes.data ?? [],
    sessions: sessionsRes.data ?? [],
    analyses: analysesRes.data ?? [],
    longitudinal: longitudinalRes.data ?? [],
    molecular_analyses: molecularRes.data ?? [],
    patient_memory_assertions: assertionsRes.data ?? [],
    case_queries: queriesRes.data ?? [],
    audit_log: auditRes.data ?? [],
    counts: {
      patients: patientsRes.data?.length ?? 0,
      sessions: sessionsRes.data?.length ?? 0,
      analyses: analysesRes.data?.length ?? 0,
      longitudinal_reports: longitudinalRes.data?.length ?? 0,
      molecular_analyses: molecularRes.data?.length ?? 0,
      memory_assertions: assertionsRes.data?.length ?? 0,
      case_queries: queriesRes.data?.length ?? 0,
      audit_rows: auditRes.data?.length ?? 0,
    },
  };

  audit(supabase, user.id, {
    action: 'art18_data_export',
    context: { counts: exportBundle.counts },
    ip: extractClientIp(req.headers),
    user_agent: req.headers.get('user-agent'),
  });

  const filename = `therapai-export-${user.id}-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(exportBundle, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
