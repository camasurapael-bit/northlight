# Northlight Studio — real-time appointment booking (bento grid UI)

A complete, self-contained appointment booking system. No build step, no dependencies,
no backend required: open `index.html` and everything works, offline, with data stored
in `localStorage` and synced live between browser tabs.

---

## Quick start

**Option 1 — just open it**

Unzip and double-click `index.html`. That is the whole app.

**Option 2 — serve it (recommended, needed for the cross-tab realtime channel)**

```bash
cd appointment-app
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static server works (`npx serve`, `php -S localhost:8080`, nginx, GitHub Pages, …).

Open the app in **two tabs side by side** to watch real-time sync: book a slot in one tab
and the other tab's calendar, slot grid and dashboard update within milliseconds.

---

## Feature tour

### Booking flow (wizard, 5 steps)
| Step | What it does |
|---|---|
| 1 · Service | 6 services, each with its own duration, price and turnaround buffer |
| 2 · Specialist | 5 staff members; people who don't deliver the selected service are dimmed and unclickable |
| 3 · Date | Month calendar, Monday-first, showing the live free-slot count per day |
| 4 · Time | Generated slot grid; booked and too-soon slots are disabled and struck through |
| 5 · Details | Summary ticket + validated form (name, email, phone, notes, policy consent) |

### Reality features (this is the part that makes it a real booking system)

- **Availability engine** — slots are computed from each person's working hours, service duration and
  turnaround buffer. A candidate slot is only offered when it survives four independent tests:
  working-hours fit, no overlap with any live booking, minimum notice, booking window.
- **No double booking, structurally** — every booking occupies `start → start + duration + buffer`,
  so back-to-back clashes are impossible. The slot is **re-verified at submit time**, so if another
  tab or customer grabbed it a second earlier you get "Slot just taken" instead of a silent conflict.
- **Timezone-aware** — the studio runs on `Europe/London`. Every zone in the IANA database is in the
  picker; slot times show clinic time with your local time underneath, and confirmations show both.
  Conversions use `Intl` offset maths (DST-safe), not naive fixed offsets.
- **Minimum notice & booking window** — 2 hours' notice, 60 days ahead, enforced in the slot grid
  and the calendar.
- **Live desk** — opening status (open now / closed), a ticking studio clock, and your timezone beside it.
- **Next up** — countdown to the next appointment (yours if we know your email, otherwise the studio's next).
- **Confirmation** — booking reference (`BK-XXXXXX`), downloadable **`.ics`** invite with a built-in
  VALARM reminder, one-click **Google Calendar** link, printable ticket, copyable shareable link.
- **Lookup / reschedule / cancel** — find bookings by email *or* reference, move them to any other free
  slot (self-exclusion so a booking never clashes with itself), cancel with a free-vs-late policy check,
  or reinstate a cancelled booking — which re-checks slot availability first.
- **Audit trail** — every booking keeps a history of `created / rescheduled / cancelled / completed /
  edited` events with timestamps, shown in the detail modal and the admin drawer.
- **Reminders** — opt in to browser notifications; a 30-second scheduler fires one hour before each
  upcoming appointment while the tab is open.
- **Deep links** — `index.html?ref=BK-4KQ7T2` opens straight onto that booking (shareable link).
- **Realtime cross-tab sync** — `BroadcastChannel` plus a `storage` fallback; every mutation repaints
  every open tab.
- **Offline-first persistence** — bookings and preferences survive reloads; a memory fallback keeps
  the app working even where storage is blocked.

### Admin dashboard (staff area)
- Staff sign-in — separate from customer accounts. Username `admin` (change `ADMIN_USER` / `ADMIN_HASH` at the top of `js/admin.js`). Session lasts 2 hours or until the tab closes, with a 5-try / 30-second lockout. Front-end only: use a real server login before going live.
- **Load demo data** button: generates ~26 realistic bookings across past and future dates without
  creating a single conflict (it asks the same slot engine for free times).
- KPIs: total bookings, confirmed, revenue booked, **utilisation of the next 7 days of studio hours**,
  average lead time, cancellation rate.
- 14-day bookings-per-day bar chart with hover tooltips.
- Filters: specialist, service, status, date-from, date-to, free-text (name / email / phone / reference).
- Row actions: mark completed, cancel, reinstate, open detail drawer, download `.ics`.
- **CSV export** of the current filtered view (BOM-prefixed so Excel opens it cleanly).
- Waitlist count surfaced on the dashboard chip.

### Interface
- **Bento grid layout** — CSS Grid with 6 columns, deliberately varied tile spans
  (hero 4×2, live desk 2×1, next up 2×1, services 3×2, specialists 3×2, calendar 4×3,
  times 2×3, form 3×4, my bookings 3×4, admin full width), and a `dense` auto-flow so tiles
  pack without holes. It collapses to 2 columns on tablets and a single column on phones.
- **Light & dark themes** — one click, remembered between visits, driven entirely by CSS custom properties.
- **Accessibility** — skip link, ARIA roles on the calendar/radiogroups/listbox, live regions for the
  clock, toasts and modal, visible focus rings, keyboard-operable everything, `prefers-reduced-motion`
  respected, print stylesheet for tickets.
- Zero dependencies. No framework, no bundler, no network calls at runtime.

---

## Project structure

```
appointment-app/
├── index.html          # markup: top bar + bento tiles + modal + toasts
├── styles.css          # design tokens, bento spans, all component styles
├── js/
│   ├── store.js        # catalogue, timezone maths, availability engine, persistence, ICS
│   ├── config.js       # Google Client ID (turns on the real Google account picker)
│   ├── auth.js         # sign-in gate: Google picker / manual Gmail, Apple demo, email
│   ├── app.js          # booking wizard, calendar, slots, validation, lookup, reminders
│   └── admin.js        # dashboard: stats, chart, filters, CSV export
├── tests/
│   └── engine.test.js  # node test for the availability engine (no browser needed)
└── README.md
```

## Run the engine tests

```bash
cd appointment-app
node tests/engine.test.js
```

Covers: DST-crossing timezone conversion, buffer/overlap prevention, double-booking rejection,
minimum-notice enforcement, reschedule self-exclusion, cancel → slot release, and ICS validity.

## Currency

Prices are in **Philippine peso (₱ / PHP)**. They were **re-priced to plausible local
amounts**, not symbol-swapped — a 60-minute strategy session reading "PHP 180" would be nonsense:

| Service | Duration | Price |
|---|---|---|
| Intro consultation | 30 min | Free |
| Follow-up check-in | 30 min | ₱1,500 |
| Design review | 45 min | ₱4,500 |
| Strategy session | 60 min | ₱6,500 |
| Technical build call | 90 min | ₱9,500 |
| Studio photo session | 120 min | ₱12,000 |

Every amount in the UI, the confirmation ticket, the printable receipt and the admin
dashboard goes through one function — `U.money()` in `js/store.js` — which formats with
`Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })` for proper thousands
grouping, and falls back to a deterministic manual format where ICU data is thin, so the
output string is identical on every machine.

To change currency again: edit the single `CURRENCY` object at the top of `js/store.js`
(and the `price` values in `SERVICES`). The CSV export writes the raw number in a
`Price (PHP)` column so spreadsheets can total it.

## Notes & limits

- Data lives in the browser (`localStorage`), so it is per-device — clearing site data resets it.
  Swap `Store` for HTTP calls to make it multi-user; the rest of the app is already written against that API.
- Emails are "queued" in the UI copy only; there is no SMTP in a static app.
- Reminders require the tab to be open (browser Notification API limitation).

MIT-style: take it, restyle it, ship it.

---

## Authentication gate

Clicking **Start a booking** (or opening the Admin tab) with no session now shows a
**Log in / Create account** screen with:

- social buttons — **Continue with Google** (official white/Google-blue button) and
  **Sign in with Apple** (black button, Apple mark);
- email + password log in, and a create-account form (name, email, password, confirm, terms);
- a guest escape hatch that opens booking lookup without an account.

The gate sits on the **Start a booking** call to action and on the staff dashboard. The landing
page itself stays browsable, the **Keep browsing** link closes the sign-in screen, and a signed-out
guest who filled in the form is stopped when they press **Confirm booking** — the gate opens and the
slot is held until they sign in. Booking lookup by reference stays open to everyone.

### Google sign-in: real account picker + manual Gmail

The **Continue with Google** button works in two modes:

| Mode | When | What happens |
|---|---|---|
| **Real Google** | `googleClientId` is set in `js/config.js` and the app is served over http/https | Opens Google's own account picker: it lists the Gmail accounts signed in on the device and has **Use another account** to type one. Google confirms the email, and the session is marked *Verified by Google*. |
| **On-device chooser** (fallback) | No client ID, opened as a `file://`, or Google unreachable | Opens an in-app chooser: Gmail accounts saved on this device, plus **Use another account** where you type your Gmail by hand (`name@gmail.com`). The session is marked *Entered manually (not verified)*. |

To turn on the real picker (free):

1. Go to console.cloud.google.com → **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
2. Under **Authorised JavaScript origins** add where the app runs, e.g. `http://localhost:8080` and your live domain.
3. Paste the Client ID into `js/config.js`:
   ```js
   window.NORTHLIGHT_CONFIG = { googleClientId: '1234567890-abc123.apps.googleusercontent.com' };
   ```
4. Serve the app (`python3 -m http.server 8080`) and open `http://localhost:8080`. It will not work from a double-clicked `index.html`.

The app never sees your Google password; it only asks for `openid email profile`. Because the app is front-end only, a determined user can still edit `localStorage`, so for real security verify the Google token on a backend before trusting the session.

**Apple and email/password are still simulated, front-end only.** No request leaves the browser for those; the
mock session is written to `localStorage['northlight.session.v1']`
(`{ id, name, email, provider, verified, initials, createdAt }`). Passwords are never stored. The session survives
reload, is prefilled into the booking form, and is cleared by **Sign out** in the account menu (avatar chip in the header).

### Wiring up the rest for real

1. **Apple** — in the Apple Developer portal create a **Services ID** + a Sign in with Apple key,
   register your domain and return URL, then use `AppleID.auth.init({ clientId, redirectURI, scope, usePopup })`
   with the hosted `appleid.auth.js`. Apple requires the black button, the Apple logo, and
   "Sign in with Apple" as the label.
2. **Backend** — Firebase Auth (`signInWithPopup(GoogleAuthProvider / OAuthProvider('apple.com'))`)
   or Supabase (`signInWithOAuth({ provider: 'google' | 'apple' })`) both cover the social flow; for
   email use Firebase/Supabase email+password so verification and reset emails are handled for you.
3. **Then swap the simulation**: in `js/auth.js`, replace the Apple `setTimeout` in `socialSignIn()` and the
   local credential check in `submitSignin()` / `submitCreate()` with the provider call, store the
   returned ID token/user in the session object, and keep `NS.auth.gate()` as the route guard.

---

## Latest features (Oct 2026)

**Customer side**
- **Several services in one visit** — tap more than one service; only specialists who offer all of them are shown, and the slot is the combined length.
- **Payment choice** — *Pay at the salon* (confirmed straight away) or *Pay now with GCash* (slot is held as **pending** until staff confirm the payment). Set the real number in `js/store.js` → `GCASH`.
- **Waitlist** — a full day shows *Notify me if a slot opens*. When someone cancels or moves, the waiting customer sees a banner under **Next up** and in **My bookings**.
- **My bookings** — Upcoming / Past / All tabs, **Book again**, and **Rate visit** (1–5 stars + comment). Specialist cards show their average rating.
- **Gmail code sign-in** — `api/send-otp.js` + `api/verify-otp.js` (Vercel serverless, Brevo). Vercel → Settings → Environment Variables: `BREVO_API_KEY` (xkeysib-…), `OTP_SENDER_EMAIL` (a sender verified in Brevo), `OTP_SECRET` (long random text). Codes are signed, never stored, expire in 5 minutes.
- **Theme** follows the phone (light/dark) until you tap the toggle; **installable app** (PWA: `manifest.webmanifest`, `sw.js`, `icons/`); **English / Tagalog** switch (`js/i18n.js`, edit the `TL` table to change wording).

**Staff side** (Admin tab → staff sign-in)
- Confirm GCash payments, reschedule, cancel, complete, mark paid.
- **+ Walk-in** booking (ignores the 2-hour notice rule).
- **Staff schedule** — weekly hours per specialist, days off, whole-studio closures.
- **Report** — today / week / month / custom range, totals by service and specialist, collected vs. still to collect, print/PDF and CSV, plus reviews.

**Tests:** `node tests/engine.test.js` (79 checks) and `node tests/otp.test.js` (9 checks).

**Known limits:** the staff list and rules live in Firebase (see below). Without the database (no `js/cloud.js`, or Firebase unreachable) the app falls back to this-device-only storage.

---

## Shared database (Firebase Firestore)

Bookings are now stored in **Firestore** (project `northlight-cc676`, free Spark plan) so a booking made on a phone shows up on the staff laptop, and two people can never take the same time.

**How it works**
- `bookings/{BK-REF}` — one document per booking. Staff see all; a customer sees only their own (by device, or by Google email); anyone with the reference can look one up.
- `days/{specialist}__{date}` — only the *taken time ranges* (no names, no emails). Booking runs a transaction on this document, so overlapping times are refused even if two people tap at the same second.
- `schedule/main` — weekly hours, days off and closures (staff write, everyone reads).
- `staff/{uid}` — who is staff. Added by hand in the console; the app cannot write it.
- Files: `js/cloud.js` (connection), hooks in `js/store.js`, `firestore.rules`.

**One-time setup in the Firebase console**
1. **Authentication → Sign-in method:** enable **Anonymous** and **Email/Password** (Google stays on).
2. **Authentication → Users → Add user:** create your staff account (email + password). Copy its **User UID**.
3. **Firestore Database → Data → Start collection:** collection ID `staff`, Document ID = that UID, add any field (e.g. `role` = `owner`).
4. **Firestore Database → Rules:** paste the contents of `firestore.rules` and **Publish**.
5. **Authentication → Settings → Authorized domains:** make sure your Vercel domain is listed.

Staff then open the **Admin** tab and sign in with that **email** and password. The session lasts 2 hours or until the tab closes.

**Free-tier use:** every visitor reads the taken-time documents for the next days plus their own bookings; staff read all bookings once per session. A small studio stays far inside the Spark limits. On Spark nothing is ever billed; if a daily limit were hit, requests just pause until the next day.

**Good to know**
- Demo data and the wipe button are disabled while the shared database is on (they would pollute it).
- A customer who signed in with a code or a password (not Google) sees bookings made on *this* device; Google sign-in also finds them on other devices by email.
- Ratings shown on specialist cards come from the bookings the viewer can see (staff see all).
- The waitlist is still per device.

**Tests:** `node tests/cloud.test.js` (56 checks, uses an in-memory fake Firestore with several simulated devices), plus `engine.test.js` and `otp.test.js`.
