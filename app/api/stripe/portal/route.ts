// app/api/stripe/portal/route.ts
// Creates a Stripe Customer Portal session for the authenticated therapist.
// Returns { url } that the client redirects to. Portal lets the clinician
// manage payment methods, view invoices, cancel subscription.

import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: therapist } = await supabase
    .from('therapai_therapists')
    .select('stripe_customer_id, email')
    .eq('id', user.id)
    .maybeSingle();

  if (!therapist) return NextResponse.json({ error: 'therapist_not_found' }, { status: 404 });
  if (!therapist.stripe_customer_id) {
    return NextResponse.json({
      error: 'no_stripe_customer',
      message: 'Nenhuma assinatura encontrada. Entre em contato com andrefiker@gmail.com para iniciar o plano.',
    }, { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://therapai-one.vercel.app';

  const session = await stripe.billingPortal.sessions.create({
    customer: therapist.stripe_customer_id,
    return_url: `${origin}/app/settings`,
  });

  return NextResponse.json({ url: session.url });
}
