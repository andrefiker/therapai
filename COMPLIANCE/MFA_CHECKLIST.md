# MFA Enablement Checklist (LGPD F8)

**Operator handoff.** All toggles are in the vendor's dashboard — TherapAI cannot enable them programmatically. Each one closes a single-point-of-failure red-ball risk in `RIPD.md` section 3 (admin credential compromise).

Status legend: ☐ pending · ☑ enabled · — not applicable

---

## Tier 1 — Direct credentials to clinical data

### ☐ Supabase
- URL: https://supabase.com/dashboard/account/security
- Method: **TOTP (Authenticator app)** preferred. Recovery codes — print and store in password manager.
- Why: Supabase admin gets direct DB access to all patient data. Highest-leverage credential after Vercel.
- Bonus toggle at the same time: Supabase Auth → **Leaked Password Protection** (advisor flagged it; one click).

### ☐ Vercel
- URL: https://vercel.com/account/security
- Method: **TOTP**. Hardware key if you have one (YubiKey, etc.).
- Why: Vercel project access reveals `SUPABASE_SERVICE_ROLE_KEY` env, which bypasses RLS and reads everything.
- Plus: review **Team Members** → only André should have access. No leftover collaborators.

### ☐ Anthropic Console
- URL: https://console.anthropic.com/settings/security
- Method: **TOTP**.
- Why: Anthropic API key controls inference billing + transcript-in-flight access at the provider.
- While here: confirm **Data Privacy / Usage** is set to *no training on submitted data* (default true for API).

### ☐ OpenAI
- URL: https://platform.openai.com/account/multi-factor-authentication
- Method: **TOTP**.
- Why: Same shape as Anthropic — API key controls billing + fallback inference path.
- While here: organization → **Data Controls** → confirm "Allow models to be trained on your data" is OFF (this is the OpenAI zero-retention opt-in for the API tier; ISC-27).

### ☐ Fireflies.ai
- URL: https://app.fireflies.ai/settings/security
- Method: **TOTP** (their UI may call it 2FA).
- Why: Fireflies account holds the original transcripts of every recorded session. Biggest non-DB blob of clinical content.

### ☐ Recall.ai (when account is provisioned)
- Toggle MFA immediately on signup, before requesting the DPA, before generating the production API key.

---

## Tier 2 — Payment + identity

### ☐ Stripe
- URL: https://dashboard.stripe.com/settings/security
- Method: **Hardware key + TOTP backup**.
- Why: Stripe sees customer billing data. Doesn't have clinical content but the financial side matters for the business.

### ☐ GitHub
- URL: https://github.com/settings/security
- Method: **Hardware key + TOTP backup**.
- Why: Repo holds the code; lost repo = competitor risk + supply-chain risk if attacker pushes malicious code. Vercel auto-deploys on push to master, so a GitHub compromise would deploy malware to production.

### ☐ Google Workspace / Gmail (andrefiker@gmail.com)
- URL: https://myaccount.google.com/security
- Method: **2-Step Verification** with Authenticator + backup codes.
- Why: This email is the recovery path for almost every vendor above. Single point of failure for the entire credential set.

---

## Tier 3 — Defensive hardening (after Tier 1+2)

### ☐ Password manager — full credential rotation
- Rotate ALL six vendor passwords using the password manager's generator.
- Confirm Supabase service_role key is regenerated post-MFA (defensive — if the key was ever exposed in `git log -p` or a chat transcript, it stays valid until rotated regardless of MFA).
- Rotate `STRIPE_WEBHOOK_SECRET` and `FIREFLIES_WEBHOOK_SECRET` in vendor dashboards + Vercel env.

### ☐ Recovery codes — printed + sealed
- For each vendor's MFA, store recovery codes physically (sealed envelope, fireproof box). Digital-only copies in a password manager are acceptable but not exclusive.

---

## Completion log

When each line above is done, update the `☐` to `☑` and date in this file. Then commit. The act of committing is the audit trail.

```
☑ Supabase TOTP — YYYY-MM-DD
☑ Supabase leaked-password-protection — YYYY-MM-DD
...
```

When ALL Tier 1 items are ☑, mark **ISC-8** in the LGPD ISA as `[x]` with a one-line evidence quote.
