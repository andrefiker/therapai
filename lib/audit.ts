// lib/audit.ts — LGPD application-layer audit trail (ISA F5.2).
//
// Records every clinician access to clinical data. Fire-and-forget: never
// blocks the caller path. Use the auth-aware Supabase client (RLS enforces
// actor_user_id = auth.uid() on INSERT).
//
// Privacy of audit records: IPs are stored as SHA-256(ip + AUDIT_IP_SALT)
// truncated to 32 hex chars — pseudonymized, not directly identifying.
// Set AUDIT_IP_SALT in Vercel env and rotate annually or after incident.

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const IP_SALT = process.env.AUDIT_IP_SALT ?? 'therapai-audit-default-salt-rotate-me';

export interface AuditRecord {
  action: string;
  target_table?: string | null;
  target_row_id?: string | null;
  context?: Record<string, unknown>;
  ip?: string | null;
  user_agent?: string | null;
}

export async function audit(
  supabase: SupabaseClient,
  actorUserId: string,
  record: AuditRecord,
): Promise<void> {
  try {
    const { error } = await supabase.from('therapai_audit_log').insert({
      actor_user_id: actorUserId,
      action: record.action,
      target_table: record.target_table ?? null,
      target_row_id: record.target_row_id ?? null,
      context: record.context ?? null,
      ip_hash: record.ip ? hashIp(record.ip) : null,
      user_agent: record.user_agent?.slice(0, 500) ?? null,
    });
    if (error) console.error('[audit] insert failed', error.message);
  } catch (e) {
    console.error('[audit] insert threw', e);
  }
}

function hashIp(ip: string): string {
  return createHash('sha256').update(ip + IP_SALT).digest('hex').slice(0, 32);
}

export function extractClientIp(headers: Headers): string | null {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return headers.get('x-real-ip');
}
