# TrustHand

Give an errand helper a capped, revocable spending limit instead of your card, PIN or banking app.
TrustHand is an installable PWA built on Interledger Open Payments. The Owner sets a EUR limit (1 to 50), the Helper can only pay up to that limit, and **Single-Errand Auto-Lock** revokes the grant right after the first successful payment so any unused remainder cannot be spent anywhere else.

## Run it (for judges)

Requirements: Node.js 18+, an Interledger test wallet account for the Owner (EUR) and one for the Seller (USD), and a developer key pair registered on the Owner wallet.

1. `git clone <repo-url> && cd trusthand`
2. `npm install`
3. `cp .env.example .env` and fill in `OWNER_WALLET_ADDRESS`, `SELLER_WALLET_ADDRESS`, `KEY_ID`. Put the matching private key at `./private.key`.
4. Put the 38 `.mp3` voice clips flat inside `public/sounds/` (for example `grant_set_en.mp3`, `20.mp3`, `euros_limit.mp3`, `auto_locked.mp3`). If a clip is missing, the app falls back to browser speech.
5. `node server.js` and open http://localhost:3000
6. **Demo script:**
   1. On the Owner phone choose `€20`, keep Auto-lock ON, tap **Set limit and approve**, and approve in the wallet window.
   2. On the Helper phone pick `€12 Pharmacy Errand` and tap **Pay seller**. The payment goes through and the grant is auto-locked.
   3. Try `€8 Second Shop Test`: it is blocked (`AUTO_LOCKED`).
   4. Repeat with Auto-lock OFF and try `€25 Overspend Test` after spending: it is blocked (`LIMIT_EXCEEDED`).
   5. Tap **Stop Helper Access** at any time to revoke the grant (`REVOKED`).

To test on a phone, open the server over HTTPS (for example with a tunnel) and set `BASE_URL` in `.env` so the wallet redirect returns to the right address. Then use **Install App**.

## Primary user research

We surveyed **19 respondents** about errands and money:

- **84.2%** share card/PIN or unlocked banking app access for errands.
- **81.3%** of errand runners had uncapped full-account access.
- **42.1%** personally experienced, or know someone affected by, missing or overspent funds.
- **84.2%** would adopt TrustHand.

## Working features (live Interledger Open Payments)

- Interactive outgoing-payment grant on the Owner's EUR wallet with a debit cap and time interval.
- Quote from the Owner wallet to the Seller's USD wallet, then an outgoing payment using the capped token.
- Single-Errand Auto-Lock: grant token revoked immediately after the first successful payment.
- Manual revoke ("Stop Helper Access"), plus server-side `LIMIT_EXCEEDED`, `REVOKED` and `AUTO_LOCKED` rejections.
- Installable PWA (manifest, service worker, iOS instructions), split demo view and single phone view.
- Spoken receipts stitched from ElevenLabs `.mp3` clips in English and Pidgin, with speech synthesis fallback.

## Planned production features

- Nigerian mobile money wallet support.
- NIBSS and POS payout bridges so Sellers can receive in naira.
- Persistent sessions in a database, with separate Owner and Helper logins and real device pairing.
- Multiple concurrent errands per Owner.

## Known limitations

- Session state is held in memory: restarting the server forgets the active errand. One errand at a time.
- Owner and Helper screens share one backend session in this demo; there is no authentication between them.
- The interactive grant callback does not yet verify the `hash` parameter.
- The Open Payments API cannot report wallet balances, so the Owner screen shows the limit, not savings.
- The manifest uses an SVG icon. Some platforms (notably iOS home screen) prefer PNG icons.
- Voice clips cover whole euro amounts 0 to 59 only.

## AI usage and credits disclosure

AI tools assisted this project. **Claude** and **Gemini** helped with code scaffolding, debugging and documentation. **ElevenLabs** generated the voice clips in `public/sounds/`. All code was reviewed and tested by the team.
