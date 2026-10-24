# Breach response (NDPC/NDPR, round 5 section 14)

Matches privacy.astro section 15: "If a personal data breach occurs that is likely to result in a risk to your rights and freedoms, we will notify the Commission within seventy-two (72) hours of becoming aware of it... and, where the breach is likely to result in a high risk ... we will inform you without undue delay."

This is a runbook, not policy text. The owner (Tobe, MICADOT-NG LIMITED) is the only person who can make the NDPC notification; this document exists so that step happens inside 72 hours instead of being figured out from scratch under pressure.

## What counts as a breach

Any of: unauthorised access to the database or hosting account; a leaked API key, JWT secret or admin credential; a misconfigured endpoint that exposed one user's data to another; a lost/stolen device with cached data (app lock bypassed); a provider (Render, MongoDB Atlas, Brevo, Postmark, Google, Paystack) reporting a breach that includes Automonie's data; accidental disclosure (e.g. a support reply or an admin export sent to the wrong address).

Not every security bug is a breach — only once personal data has actually been accessed, altered, lost or disclosed without authorisation. If unsure, treat it as one until ruled out; the clock (see below) starts from when someone at Automonie becomes aware, not from when it is confirmed.

## Clock starts: "becoming aware"

The 72 hours starts when any of the following first happens:
- The owner or a contributor notices anomalous access, an exposed secret, or a provider alert.
- A user reports something that turns out to be a breach.
- A provider (Render, MongoDB Atlas, etc.) emails a security notice naming Automonie's project/account.

Write the exact time this happened down immediately (a line in this file's "Incident log" section below, or a dated note anywhere durable) — the Commission will ask.

## Step by step (first 24 hours)

1. **Contain it.** Rotate the secret or credential involved (`JWT_SECRET`, `MONGODB_URI`, provider API keys on Render's environment variables). Revoke sessions if tokens may be compromised: there is no "kill all sessions" switch yet — rotating `JWT_SECRET` invalidates every existing token at once (everyone is signed out), which is the fastest stop-gap. Disable a specific endpoint (comment it out, redeploy) if the leak is endpoint-specific.
2. **Scope it.** How many users, which fields, since when. Query `AdminAccessLog` and server logs (Render's log viewer) for anything unusual in the relevant window. If the breach came through a bug, write down which commit introduced it and which deploy windows were affected (every account created or active in that window is potentially in scope).
3. **Decide the risk level.** "Likely to result in a risk to rights and freedoms" → notify the Commission (always, unless you can show no real risk — financial data is sensitive enough that this bar is usually met). "Likely to result in a HIGH risk" → also notify affected users directly, in plain language, without undue delay.
4. **Draft the NDPC notification** (template below) and send it within 72 hours of the "becoming aware" time from step 0, even if the investigation in step 2 is not finished — NDPA allows a phased notification: send what is known now, follow up with more detail once available.
5. **If high risk: email affected users** using the template below, from the support address, as soon as the facts are solid enough to be accurate (do not wait for the NDPC notification to go out first; they can go out close together).

## Who does what

- **Tobe (owner, data protection contact for MICADOT-NG LIMITED):** makes the NDPC notification, approves the user-facing email, is the point of contact for the Commission.
- **Whoever is on the Claude Code session when it is found:** contains and scopes it (steps 1-2), drafts the notifications for the owner to review and send, and records the incident log entry.

## NDPC notification template (section 15)

> To: Nigeria Data Protection Commission (via its official channels)
> Subject: Personal data breach notification — Automonie (MICADOT-NG LIMITED)
>
> 1. Controller: MICADOT-NG LIMITED (RC 9864079), operating Automonie (automonie.com).
> 2. Nature of the breach: [what happened, in one paragraph — e.g. "an exposed database credential allowed unauthorised read access to the transactions collection for approximately N hours"].
> 3. Categories and approximate number of data subjects affected: [e.g. "approximately N registered users whose accounts were active between DATE and DATE"].
> 4. Categories and approximate volume of personal data records affected: [e.g. "transaction descriptions, amounts and bank names; no card numbers or passwords, which we do not store in plain form"].
> 5. Likely consequences: [e.g. "financial data exposure; no indication of fraud as of this notice"].
> 6. Measures taken or proposed: [e.g. "credential rotated at HH:MM, endpoint disabled, affected users will be notified directly, a security review of X is underway"].
> 7. Contact point: tobe@automonie.com.
>
> We became aware of this on [date/time]. This notification is being sent within 72 hours of that time[, as a first notification; further detail will follow as the investigation concludes, if applicable].

## User notification template (high risk only, section 15)

> Subject: Important: a security issue affecting your Automonie data
>
> Hi [first name],
>
> We're writing to tell you about a security issue that affected your Automonie account. On [date], we found that [plain-language description — what happened, not jargon]. This may have exposed [specific categories: e.g. "your transaction descriptions and the bank names on your account, but not your password or full account numbers"].
>
> We [fixed it by doing X] at [time]. [If relevant: "We recommend you change your password as a precaution" / "No action is needed from you."]
>
> If you have questions, reply to this email or write to tobe@automonie.com. You can also contact the Nigeria Data Protection Commission.
>
> The Automonie team

## Incident log

None recorded. Add an entry here (date, what happened, when notified, outcome) the first time this runbook is used, so the next session and the owner have a record.
