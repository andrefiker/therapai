// lib/stripe.ts — single Stripe client + small helpers for the TherapAI billing surface.

import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.warn('[stripe] STRIPE_SECRET_KEY missing — billing endpoints will fail.');
}

export const stripe = new Stripe(STRIPE_SECRET_KEY ?? 'sk_unset', {
  apiVersion: '2026-04-22.dahlia',
  typescript: true,
});

// Maps Stripe subscription.status → human-readable Portuguese label for UI.
export function subscriptionStatusLabel(s: string | null | undefined): { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' } {
  switch (s) {
    case 'active': return { label: 'Ativa', tone: 'ok' };
    case 'trialing': return { label: 'Em período de teste', tone: 'ok' };
    case 'past_due': return { label: 'Pagamento em atraso', tone: 'warn' };
    case 'unpaid': return { label: 'Não paga', tone: 'bad' };
    case 'canceled': return { label: 'Cancelada', tone: 'bad' };
    case 'incomplete': return { label: 'Incompleta', tone: 'warn' };
    case 'incomplete_expired': return { label: 'Incompleta (expirada)', tone: 'bad' };
    case 'paused': return { label: 'Pausada', tone: 'warn' };
    default: return { label: 'Sem assinatura', tone: 'neutral' };
  }
}

export function isActiveLikeStatus(s: string | null | undefined): boolean {
  return s === 'active' || s === 'trialing';
}
