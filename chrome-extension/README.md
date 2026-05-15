# TherapAI Meet Launcher — Chrome Extension

Auto-launches the TherapAI recording bot whenever you open a Google Meet. Zero-click bot dispatch.

## What it does

When you navigate to any `https://meet.google.com/abc-defg-hij` URL, the extension automatically POSTs the meeting URL to your TherapAI backend's `/api/recall/launch` endpoint. The backend resolves your therapist tenant via your existing TherapAI session cookies and dispatches a Recall.ai bot to that meeting. The bot will knock at the door within ~30 seconds — you click **Admit** when it shows up.

**You still need to:**
- Be signed in to TherapAI in the same Chrome profile (the extension uses your session cookies)
- Click Admit when the bot knocks (Google Meet doesn't allow auto-admit for non-domain participants)

**You no longer need to:**
- Paste the Meet URL into the dashboard
- Click Launch

## Install (local — unpacked)

1. Open Chrome → `chrome://extensions`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select this folder (`chrome-extension/`)
5. The extension icon (a blue "T") will appear in your toolbar

## First-time setup

1. Click the extension icon → **Settings**
2. Confirm the API base URL (default: `https://therapai-one.vercel.app`)
3. Save
4. Sign in to TherapAI (`https://therapai-one.vercel.app`) in the same Chrome profile

## How it triggers

The extension listens for `chrome.tabs.onUpdated` events. When a tab finishes loading a URL matching `meet.google.com/[a-z]{3,4}-[a-z0-9]{3,4}-[a-z0-9]{3,4}`, it waits ~2 seconds for the page to stabilize, then POSTs to `/api/recall/launch`.

**Dedup:** A 10-minute sliding window keyed on the cleaned Meet URL prevents double-launching when you reload or navigate back to the same meeting.

**Notifications:** Chrome notifications surface success and error states (login expired, tenant not provisioned, network error, etc.).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "TherapAI: not signed in" notification | Session cookie expired | Open the TherapAI dashboard, sign in, reload the Meet tab |
| Nothing happens when opening Meet | Extension not loaded / disabled | Check `chrome://extensions` |
| Bot never joins | Backend launch failed | Check Chrome notifications + Vercel logs |
| Same Meet launches twice | Reopened after >10 min | Expected — dedup window expired |
| Want to cancel a wrongly-launched bot | UI in TherapAI dashboard | Use the bot management section |

## Re-launching the same Meet on purpose

If you genuinely want to relaunch within the 10-min dedup window:
1. Click the extension icon → **Clear dedup**
2. Reload the Meet tab → bot fires again

## What it does NOT do

- Does not store any of your data
- Does not transmit anything beyond the meeting URL to your own TherapAI backend
- Does not require API keys (uses your session cookies)
- Does not work on mobile Chrome (extensions aren't supported there)
- Does not work in Firefox / Safari (Manifest V3 Chrome extension; Firefox needs adaptation)

## Future

When [M5 Calendar OAuth](../../.claude/PAI/MEMORY/WORK/therapai/M5_PLAN.md) ships in the main app, the bot will also auto-launch for scheduled Meets even when you don't manually open the tab (e.g., bot joins from a phone reminder you forgot to click). This extension stays useful for ad-hoc Meets that aren't on your calendar.

## Publishing to Chrome Web Store (later)

When ready:
1. Zip the `chrome-extension/` folder (excluding `.DS_Store` etc.)
2. Submit at <https://chrome.google.com/webstore/devconsole>
3. $5 one-time developer fee
4. ~1-7 day review time
5. Once approved, clinicians can install via direct link — no developer mode toggle required

For now, "Load unpacked" is the right move (no review delays, you can iterate freely).
