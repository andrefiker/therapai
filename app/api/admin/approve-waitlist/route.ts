// app/api/admin/approve-waitlist/route.ts
// Admin-only: promote a therapai_waitlist row to a therapai_therapists row.
// Optionally creates a Stripe Customer with matching email so the webhook
// flow can auto-link when the first subscription event fires.
//
// The new therapai_therapists row gets a fresh UUID as `id` (placeholder).
// On the clinician's first magic-link login, the auth callback rewrites
// `id` to match `auth.users.id` so RLS works.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';
import { isAdminEmail } from '@/lib/admin';
import { stripe } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { waitlist_id?: string; create_stripe_customer?: boolean }

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const waitlistId = body.waitlist_id?.trim();
  if (!waitlistId) {
    return NextResponse.json({ error: 'missing_waitlist_id' }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 1. Load the waitlist row
  const { data: w, error: wErr } = await admin
    .from('therapai_waitlist')
    .select('id, email, name, crp')
    .eq('id', waitlistId)
    .maybeSingle();
  if (wErr || !w) {
    return NextResponse.json({ error: 'waitlist_not_found', message: wErr?.message }, { status: 404 });
  }

  // 2. Check if email already promoted
  const { data: existing } = await admin
    .from('therapai_therapists')
    .select('id, email')
    .ilike('email', w.email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      error: 'already_promoted',
      message: `Email ${w.email} já existe como clínico.`,
    }, { status: 409 });
  }

  // 3. Optional: create Stripe customer
  let stripeCustomerId: string | null = null;
  if (body.create_stripe_customer && process.env.STRIPE_SECRET_KEY) {
    try {
      const customer = await stripe.customers.create({
        email: w.email,
        name: w.name ?? undefined,
        metadata: {
          crp: w.crp ?? '',
          waitlist_id: w.id,
          source: 'admin_approve_waitlist',
        },
      });
      stripeCustomerId = customer.id;
    } catch (e) {
      console.error('[admin/approve] stripe customer create failed', e);
      return NextResponse.json({
        error: 'stripe_customer_failed',
        message: `Falha ao criar customer Stripe: ${(e as Error).message}. Tente novamente sem o checkbox.`,
      }, { status: 500 });
    }
  }

  // 4. Insert therapai_therapists row with a fresh UUID (placeholder id).
  //    Auth callback rewrites id to auth.users.id on first login.
  const { data: inserted, error: insErr } = await admin
    .from('therapai_therapists')
    .insert({
      name: w.name ?? w.email.split('@')[0],
      email: w.email,
      plan: 'trial',
      sessions_limit: 50,
      stripe_customer_id: stripeCustomerId,
      subscription_status: stripeCustomerId ? null : null,
    })
    .select('id, email')
    .single();
  if (insErr) {
    return NextResponse.json({ error: 'insert_failed', message: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    therapist: inserted,
    stripe_customer_id: stripeCustomerId,
    next_step: stripeCustomerId
      ? 'Crie um payment link no Stripe para este customer e envie por email ao clínico.'
      : 'Envie o link do site para o clínico — ele entra pelo email cadastrado.',
  });
}
