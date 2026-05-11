// app/api/stripe/webhook/route.ts
//
// Stripe webhook listener. Verifies signature, updates therapai_therapists
// with subscription state. Matches Stripe customer to therapist via:
//   1) stripe_customer_id (after first link) — fast path
//   2) customer.email (initial bootstrap) — slow path, sets the customer_id
//
// Events handled:
//   customer.subscription.created / updated / deleted
//   invoice.paid
//   invoice.payment_failed
//
// Anything else is acknowledged with 200 OK + no-op so Stripe stops retrying.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'webhook_unconfigured' }, { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'missing_signature' }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed', err);
    return NextResponse.json({ error: 'signature_invalid' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionEvent(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid':
      case 'invoice.payment_failed':
        await handleInvoiceEvent(event.data.object as Stripe.Invoice);
        break;
      default:
        // Acknowledge unhandled events so Stripe doesn't retry forever.
        break;
    }
    return NextResponse.json({ received: true, type: event.type });
  } catch (err) {
    console.error('[stripe-webhook] handler error', { type: event.type, err });
    // Return 200 for parsing/handler-level errors so Stripe doesn't loop;
    // we log and surface via observability. Real failures (signature, env)
    // already returned 4xx/5xx above.
    return NextResponse.json({ received: true, soft_error: (err as Error).message }, { status: 200 });
  }
}

async function handleSubscriptionEvent(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const therapistId = await resolveTherapistByCustomer(customerId);
  if (!therapistId) {
    console.warn('[stripe-webhook] could not resolve therapist for customer', { customerId, subscription: sub.id });
    return;
  }
  const currentPeriodEnd = currentPeriodEndIso(sub);
  const { error } = await admin().from('therapai_therapists').update({
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    subscription_current_period_end: currentPeriodEnd,
    subscription_updated_at: new Date().toISOString(),
  }).eq('id', therapistId);
  if (error) {
    throw new Error(`subscription_update_failed: ${error.message}`);
  }
}

async function handleInvoiceEvent(inv: Stripe.Invoice): Promise<void> {
  const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
  if (!customerId) return;
  const therapistId = await resolveTherapistByCustomer(customerId);
  if (!therapistId) return;

  const subRef = (inv as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }).subscription;
  if (!subRef) return;
  const subId = typeof subRef === 'string' ? subRef : subRef.id;
  const sub = await stripe.subscriptions.retrieve(subId);

  const { error } = await admin().from('therapai_therapists').update({
    subscription_status: sub.status,
    subscription_current_period_end: currentPeriodEndIso(sub),
    subscription_updated_at: new Date().toISOString(),
  }).eq('id', therapistId);
  if (error) throw new Error(`invoice_update_failed: ${error.message}`);
}

function currentPeriodEndIso(sub: Stripe.Subscription): string | null {
  const epoch = (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end;
  if (typeof epoch === 'number' && Number.isFinite(epoch)) {
    return new Date(epoch * 1000).toISOString();
  }
  return null;
}

async function resolveTherapistByCustomer(customerId: string): Promise<string | null> {
  const a = admin();
  const { data: byCustomer } = await a
    .from('therapai_therapists')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (byCustomer) return byCustomer.id;

  // Bootstrap path: first subscription event for this customer. Look up by
  // customer.email and link the IDs.
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return null;
  const email = (customer as Stripe.Customer).email?.toLowerCase().trim();
  if (!email) return null;

  const { data: byEmail } = await a
    .from('therapai_therapists')
    .select('id, email')
    .ilike('email', email)
    .maybeSingle();
  if (!byEmail) return null;

  await a.from('therapai_therapists')
    .update({ stripe_customer_id: customerId })
    .eq('id', byEmail.id);
  return byEmail.id;
}
