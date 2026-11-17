# AI Usage Disclosure

## Tools Used
* **Claude (Anthropic — Free tier):** Used for backend and frontend coding assistance and debugging.
* **Google Gemini Plus (Paid subscription):** Used for debugging, Interledger Open Payments API research, deployment troubleshooting, and documentation drafting.
* **ElevenLabs (Free tier):** Used for text-to-speech voice generation (in-app accessibility audio and demo video narration).

## Where and How We Used AI
* **Backend & Open Payments Integration (`server.js`):** Used Claude to scaffold the Express server routes and Interledger Open Payments testnet payment grant logic, and used both Claude and Gemini Plus to debug grant authorization and Single-Errand Auto-Lock edge cases. All wallet configurations, private key handling, and transaction flows were manually verified and tested by our team.
* **Frontend PWA (`public/live.html`, `public/index.html`):** Used Claude to assist with responsive high-contrast UI layout and status polling between the Owner and Helper views, with debugging support from Gemini Plus.
* **In-App Accessibility Audio (`public/sounds/`):** Used ElevenLabs to generate clear spoken guidance prompts and real-time payment receipt confirmations for visually impaired and elderly users.
* **Documentation & Demo Video:** Used Gemini Plus for research and structuring documentation (`README.md`, `AI_USAGE.md`), and ElevenLabs to generate the voiceover narration tracks for our 3-minute demo video.

## What Our Team Did Ourselves
* Problem definition, product architecture, and accessibility workflow design for blind, visually impaired, and elderly users.
* Provisioning Interledger Testnet wallets (`OWNER_WALLET_ADDRESS`, `SELLER_WALLET_ADDRESS`), generating cryptographic keys, configuring environment variables, and deploying to Render.
* End-to-end testing of 6-digit pairing codes, spending limits, spoken receipts, and Single-Errand Auto-Lock revocation.

## Prompt Log
TrustHand is working great with the startup splash screen and updated audio! Please update `public/index.html` (no changes needed to `server.js` or `manifest.json`) to upgrade the Owner Vault security with real hardware Touch ID (WebAuthn) and an accessible multimodal "Change PIN" flow, while keeping all existing API calls, startup splash screen, visual receipts, ping/buzzer Web Audio sounds, and `.mp3` audio sequences intact:

1. **Real Hardware Touch ID / WebAuthn Security for the Owner Vault:**
   - Replace any simulated biometric button with genuine **WebAuthn Platform Authentication** (`navigator.credentials.create` and `navigator.credentials.get`) configured with:
     - `rp: { name: "TrustHand", id: window.location.hostname }`
     - `pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }]`
     - `authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" }` (so macOS Chrome opens the native Touch ID fingerprint prompt directly without showing a QR code dialog).
   - **Enrollment & Verification Flow:**
     - If no Touch ID credential ID is saved in `localStorage` yet, clicking **"Register & Unlock with Touch ID"** calls `navigator.credentials.create()`, triggers the macOS Touch ID sensor, saves the credential `rawId` (base64) in `localStorage`, and unlocks the Owner Vault.
     - Once registered, clicking **"Unlock with Touch ID"** calls `navigator.credentials.get()` with `allowCredentials` pointing to the stored credential ID and `userVerification: "required"`, requiring a real fingerprint scan on the Mac's Touch ID sensor before unlocking.
     - Keep the 4-digit PIN pad (`1234` default, stored in `localStorage`) alongside Touch ID as a backup unlock method.

2. **Accessible Multimodal "Change PIN" Modal (Built for Elderly, Blind, Deaf & Illiterate Users):**
   - Ensure a **Lock** (`🔒`) button and a **Change PIN** (`🔑`) button appear in the Owner phone header when unlocked.
   - Inside the **Change PIN** modal:
     - **Step 1 — Touch ID Authorization (No Old PIN Required):** Let the Owner tap a large fingerprint icon button **"Verify Touch ID to Change PIN"** (running `navigator.credentials.get()` with `userVerification: "required"`, plus an optional fallback to type the old PIN) so elderly or forgetful users are never locked out if they forget their previous PIN.
     - **Step 2 & 3 — Tap New 4-Digit PIN & Confirm:** Show large visual step indicators (`1 → 2 → 3`), extra-large (`64px` tall) high-contrast number buttons (`0–9` + backspace) with `aria-label` attributes, and an audio toggle icon.
     - **Multimodal Feedback on Every Tap:** Play a gentle Web Audio key-click tone, speak the tapped digit and short step guidance via `window.speechSynthesis` (e.g., *"1"*, *"Verify fingerprint"*, *"Tap 4 new numbers"*, *"Tap the same 4 numbers again"*, *"New PIN saved"*), trigger `navigator.vibrate` pulses (`40ms` per tap, `[100, 50, 100]` on save, `[200, 80, 200]` on mismatch), and display clear emerald/crimson visual icons so deaf, blind, elderly, and non-reading users all receive unmistakable confirmation.

TrustHand is working great! Please keep `public/index.html` (the single-screen Split Demo View) completely untouched as my backup, and create a new two-device version in **`public/live.html`** along with lightweight helper-pairing endpoints in **`server.js`**:

### 1. Backend Additions in `server.js` (Keep All Existing Open Payments Routes Intact):
- Add in-memory state for `ownerAccount` (`{ name, walletAddress, pairCode, isSetup }`) and `helpers` (`[]` of `{ id, name, linkedAt, status }`), and include both `ownerAccount` and `helpers` in the JSON returned by `GET /api/status`.
- **`POST /api/owner/setup`**: Accept `{ name, walletAddress, helperNames }`. Save `ownerAccount` (defaulting `walletAddress` to `process.env.OWNER_WALLET_ADDRESS` if blank), generate a random 6-digit numeric `pairCode` (e.g., `"482910"`), optionally register any initial `helperNames` array, and return `{ ownerAccount, helpers }`.
- **`POST /api/helper/link`**: Accept `{ pairCode, helperName }`. Validate that `pairCode` (ignoring spaces/dashes) matches `ownerAccount.pairCode`. If valid, add or activate that helper in `helpers` with `status: "ACTIVE"` and return `{ helper, ownerName: ownerAccount.name }`; otherwise return `403` (`{ error: "Invalid pairing code" }`).
- **`POST /api/owner/helper-revoke`**: Accept `{ helperId }`, mark that helper as `"REVOKED"` in `helpers`, and if an active Open Payments grant exists, immediately revoke the active grant token as well so that helper loses access instantly.

### 2. New Two-Device App in `public/live.html`:
Build `public/live.html` with the same emerald (`#065F46`), warm gold (`#F59E0B`), and off-white (`#F8FAFC`) fintech styling, `Plus Jakarta Sans` + `JetBrains Mono` fonts, Web Audio ping/buzzer sounds, and `/sounds/` ElevenLabs `.mp3` receipt queue:

- **Screen 1 — Animated Splash Screen (`TrustHand by Twostack`):**
  - Show the TrustHand shield-and-hand SVG logo on the left and **"TrustHand"** + **"by Twostack"** on the right, fading smoothly into the **Select Role** screen (also dismissible on click to prime audio).

- **Screen 2 — Accessible "Select Role" Landing Page:**
  - High-contrast full-screen card layout with large icons, subtle voice narration toggle (`speechSynthesis`), and two massive tactile role buttons:
    1. **"I am the Owner"** (Shield icon — *"Create account, link helpers & control spending"*)
    2. **"I am a Helper"** (Helping Hand icon — *"Enter pairing code & pay for an errand"*)
  - Include a subtle footer link: `"Switch to 1-Screen Split Demo"` linking to `/`.

- **Screen 3A — Owner Flow (Accessible Onboarding + Multi-Helper Dashboard):**
  - **Accessible Account Setup (for Elderly, Partially Blind, Deaf & Illiterate Users):** If `ownerAccount.isSetup` is false (or when clicking **"Account & Helpers"**), show a 3-step visual setup with giant `64px+` buttons, high-contrast step indicators (`1 → 2 → 3`), spoken guidance (`speechSynthesis`), and vibration feedback (`navigator.vibrate`):
    - **Step 1 (Profile & Interledger Wallet):** Large input for Owner's name (e.g., *"Mama Tobi"*) and pre-filled Interledger Wallet Address (`$ilp.interledger-test.dev/43a3e0f4`) with a big green **"Confirm My Wallet ✓"** button so elderly/illiterate users don't have to type technical URLs.
    - **Step 2 (Vault Security):** Register real **Touch ID** (WebAuthn platform authenticator) or set a **4-digit PIN** (`1234` default) on oversized keypad buttons.
    - **Step 3 (6-Digit Pairing Code & Register Helpers):** Display the **6-digit Pairing Code** in giant `JetBrains Mono` digits with a **"Read Code Aloud 🔊"** button (so blind/non-reading owners can play it out loud to their helper) plus a quick input to pre-register one or more named helpers (e.g., *"Ade"*, *"Tobi"*).
  - **Owner Control Dashboard:** Protected by the Touch ID / 4-digit PIN lock, displaying the spending cap controls (`€20`, `€50`), Single-Errand Auto-Lock toggle, **Registered Helpers list** (showing each linked helper with an individual **"Remove / Revoke"** button), Emergency Stop / Undo Block button, visual receipt, and ElevenLabs `.mp3` spoken receipts.

- **Screen 3B — Helper Flow (Direct Entry + Instant Owner Pairing):**
  - Tapping **"I am a Helper"** enters straight into the Helper interface with **no signup or password required**.
  - If not yet linked (stored in `sessionStorage`), show a clean **"Link with Owner"** card with a **Helper Name** input (e.g., *"Ade"*), a large **6-digit Pairing Code** input, and an emerald **"Connect to Owner"** button.
  - Once linked, show *"Linked to [Owner Name]"*, live remaining allowance (updated via 4-second polling), verified seller pointer, checkout presets (`€12 Pharmacy Errand`, `€8 Second Shop Test`, `€25 Overspend Test`) + custom EUR input, live **Verified Open Payments Receipt** card, and crimson **Blocked Transaction Alert** card.

 In `public/live.html`, check `readCode()` and the audio queue playback for why reading a pairing code like `670 146` stops after `6, 7` even though `/sounds/0.mp3` and `/sounds/pairing_code_is.mp3` exist in `public/sounds/`. Make sure:

1. Digit `'0'` is never skipped or treated as falsy (e.g., avoid `if (!d)` checks on `'0'` or `0`).
2. `readCode()` plays `pairing_code_is.mp3` followed by all 6 digit `.mp3` files (`0.mp3`–`9.mp3`) sequentially without interrupting itself or breaking out of the loop if one file errors.
3. `public/sw.js` bumps its cache version and includes `0.mp3`–`9.mp3` and `pairing_code_is.mp3` so the browser doesn't serve stale cached audio responses.
4. In `public/live.html`, make sure `suShow(3)` plays `/sounds/setup_step3.mp3` instead of falling back to browser `speechSynthesis` for `"This is your pairing code. Give it to your helper"`. Check all calls to `say(...)` across `public/live.html` and `public/index.html` to verify every prompt string maps cleanly to its corresponding `.mp3` filename in `public/sounds/`, and bump the cache version in `public/sw.js` so the updated HTML and audio files load immediately.
