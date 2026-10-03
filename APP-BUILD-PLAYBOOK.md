# App Build Playbook

How I want apps planned, designed, built, tested and shipped. Give this file to Claude at the start of any new app project and follow it unless I say otherwise in that session.

**Kickoff prompt (paste into a new session):**
> Read `APP-BUILD-PLAYBOOK.md` and follow it for this project. Start with Phase 1: ask me your clarifying questions before designing anything.

---

## 1. How we work together

### Phases — don't skip ahead
1. **Clarify.** Before designing, ask all your questions in one go, with options and a recommended choice for each. Cover: who uses it, platforms, offline needs, accounts or no accounts, budget (default: free), and what "done" looks like.
2. **Prototype.** Build a single clickable HTML prototype first. Show me screenshots. Iterate until I approve.
   **Do not start the real build until I say "build".** The approved prototype is the spec.
3. **Build.** Real app, real backend, real CI. Keep the prototype's look and behaviour unless I agree to a change.
4. **Ship and iterate.** Each round of feedback becomes a release. Tell me the version number and how to get it.

### Ground rules
- **Every visible control must work** — every button, chip, tab, toggle, filter and menu. A dead control counts as a bug, not as missing scope.
- **Ask before anything you can't undo,** like deleting data, rewriting history, or changing accounts or settings outside the repo.
- **Never ask for my passwords, app passwords, or secret/service keys.** Tell me exactly where to paste them myself (dashboard → page → field). Publishable/anon keys are fine to receive.
- **Never commit secrets** (keystores, `.env`, passwords). Keep them git-ignored and in CI secrets.
- **Don't send my personal data** (email, name) to third-party services unless the feature needs it.
- **When I must do something myself** (a dashboard setting, a DNS record, a store listing), give numbered steps with exact menu names and values. Keep listing it as pending until I confirm it's done.
- **Keep updates short:** what changed, how to get it, what's still pending on my side.
- **If I say I made a mistake** (wrong account, wrong repo), stop, restore what was changed, and confirm before continuing.

---

## 2. Default product decisions (unless I say otherwise)

| Area | Default |
|---|---|
| Platforms | Mobile-first. Android APK (installed directly, no Play Store) **plus** a web version from the same codebase |
| Cost | Free tiers only — free hosting, free backend, free CI |
| Weight | Lightweight. Static files, no CDN dependencies at runtime, bundle assets locally |
| Accounts | Multi-user. Email one-time code (6 digits) that signs you in. No passwords |
| Data | **Offline-first.** Works with no internet, syncs when back online, and **shows sync status** |
| Updates | Update banner on the home screen with **Update now / Later**. Major version bump = **required** update that blocks the app. Plus a **phone notification** when a new version is out (also while the app is closed) |
| Notifications | Local reminder notifications before due dates, never after |
| Orientation | Locked to portrait on phones |
| Exports | PDF and CSV/Excel, filterable, one row per transaction |

---

## 3. UI / UX expectations

### Look and feel
- Modern, structured, **animated** (smooth, purposeful — not flashy). Glassy cards, depth, soft shadows.
- **3D icons wherever possible** (e.g. Microsoft Fluent 3D emoji, MIT — bundle them locally). Real brand logos where brands appear (banks, apps), not just coloured initials.
- **No neon or bright green.** Calm palettes. Offer several palettes as **colour circles without labels**.
- **Check both dark and light themes.** In light mode, surfaces must stand out from the background (white cards with shadows, darker secondary text). I will notice low contrast.
- **Text size:** Small / Medium / Large, plus a **Bold text** toggle. Layouts must not break or overflow at any size.
- The **selected bottom tab** uses the palette's accent colour. Scrolling content fades out **above** the tab bar, never under it.
- **Export buttons are green with an up arrow** (export = sending out).
- **Sync dot:** green = synced, orange = syncing or waiting to upload, red = offline or failed.

### Layout and navigation
- Bottom tab bar. A floating **+** button on screens where you add things; it lifts above any toast.
- Collapsible sections are **collapsed by default**. Remember only the ones the user opens.
- A section with **only one item** gets no title and no collapse — just show the card.
- **Log out** is its own button, not buried in a section.
- Less important explanations go behind a tappable **"i" button** (a small popover), not inline captions.
- Empty states show a 3D icon, one line of explanation, and action buttons.
- The Android back button closes popups and sheets first, then goes to Home, then exits.

### Feedback
- **Toasts** for success, warning and error on every action. They sit at the **bottom, above the nav bar**, with an **×** and an **Undo** for any create, edit, delete or payment.
- **No toast for settings whose effect is instantly visible** (theme, palette, text size).
- **Confirm before money or irreversible actions** ("Has it been paid?", "Delete X?"), showing the key details (amount, date, account).
- **Overdue** items say "Overdue · N days" and appear in the alerts list. Marking an overdue item paid asks whether it was **on time (just forgot to mark it)** or **late**, and if late, for the paid date and any **late charges**.

### Forms
- Bottom sheets with a **sticky submit button** on long forms, and swipe down to close.
- Submit buttons say what they do: **"Add bank account" / "Update bank account" / "Update profile"**, never a plain "Save".
- **Required star in red.** Validate inline: highlight the field, show a short message, scroll to the first error, and show a summary ("Please fix 2 highlighted fields").
- **No number-input spinner arrows.** Use text inputs with a numeric keyboard. Money gets live locale grouping (e.g. Indian `1,00,000`) and a currency prefix. Cap lengths sensibly (e.g. account numbers up to 18 digits).
- **Custom dropdowns, never the browser default.** Animated, with icons or logos per option, grouping, and search for long lists.
- **Dates display as `DD-Mon-YYYY`** with the weekday (e.g. `10-Aug-2026 Mon`), never as an ambiguous `10/08/2026`.
- **Auto-fill wherever a free lookup exists:** bank/branch from IFSC, city/state from PIN code, age from date of birth, type from keywords in the name. The user can always edit the result.
- Categories are user-editable (name, icon, defaults), with optional **sub-categories (types) that have their own icons**. If no icon is picked, show the first letter.
- **Profile:** name, photo or icon avatar (photo cropped small so it syncs), plus optional personal details.

---

## 4. Technical patterns that have worked

- **Stack:** Vite + vanilla JS ES modules, Capacitor for Android, and a free hosted Postgres with auth (e.g. Supabase) under row-level security.
- **Offline-first sync:**
  - Local store per user.
  - Each record carries an updated-at stamp and goes into a dirty queue.
  - Sync pushes the dirty records, then pulls by a server cursor. Newest edit wins.
  - Deletes are soft (tombstones).
  - File deletes wait about 15 s so Undo can't race them.
- **Auth:** email one-time codes.
  - The client allows 3 wrong attempts, then a 1-minute lock, and a 60 s resend cooldown.
  - Auto-submit on the last digit, plus a Verify button as backup.
  - Check the email templates contain the code, and make it clear what's an offline error versus a server or SMTP error.
- **Attachments:** compress images on device and cap PDF size. Store locally first, upload when online, private storage bucket.
- **Release CI:** GitHub Actions.
  - Every push to `main` builds a signed APK, publishes it as a GitHub Release with a fixed download URL, and deploys the web build to GitHub Pages.
  - Version = `major.minor` from `package.json` + the CI run number.
  - Before risky native changes (new plugins), run a test build on a branch.
- **Background tasks:** a periodic background runner for "update available" notifications while the app is closed. Mention that some phone brands kill background work to save battery.
- **CSP:** strict Content-Security-Policy. Allow-list each external API host explicitly. Guard CSV exports against formula injection.

---

## 5. Test-case document

Keep a living test-case document from the prototype stage onwards. Add new cases for every feature or bug fix. **Click through the real UI in a phone-sized preview** (both themes, all text sizes) before saying something works, and say plainly what you couldn't test (e.g. "background notification needs a real phone").

### Case format
| ID | Area | Scenario | Steps | Expected result | Priority |
|---|---|---|---|---|---|
| TC-01 | Auth | Sign up with a valid email | Enter name + email → Send code → enter the 6-digit code | Signed in automatically, onboarding shown | High |

Number feature cases `TC-xx` and security cases `SEC-xx`.

### Scenario checklist (adapt per app)
**Auth and accounts**
- [ ] Sign up, sign in, wrong code, expired code, 3 wrong codes → lock, resend cooldown, "I already have a code"
- [ ] Session expiry mid-use → re-sign-in without losing local data; log out with unsynced changes → warning
- [ ] New device sign-in pulls existing data before onboarding

**Forms and data entry**
- [ ] Every required field empty → highlighted, message shown, scrolls to the first error
- [ ] Boundary values: 0, negative, maximum, decimals, very long text, emoji in names
- [ ] Money formatting while typing, editing in the middle, pasting
- [ ] Date edge cases: month-end (31st → shorter months), leap day, past dates, far-future dates
- [ ] Auto-fill lookups: valid, invalid, offline, then editing the auto-filled value
- [ ] Add vs edit shows the right title and button label; edit pre-fills every field

**Create / read / update / delete**
- [ ] Create → shows in lists, totals, charts and filters immediately
- [ ] Edit and delete → Undo restores exactly; deleting something in use is blocked with a clear reason
- [ ] Completed items move to a Closed/History section

**Money and status logic**
- [ ] Totals, progress percentages and "remaining" values recomputed after every action
- [ ] Due today / tomorrow / in N days / overdue labels; overdue → paid on time vs late with charges
- [ ] Payment confirmations show the correct amount, date and account

**Offline and sync**
- [ ] Use fully offline → changes saved, dot turns red, pending count shown
- [ ] Reconnect → syncs automatically, dot orange → green
- [ ] Same record edited on two devices → newest wins, nothing lost silently
- [ ] Attachments added offline upload later; delete + Undo doesn't lose the file

**Notifications and updates**
- [ ] Permission denied → clear message on how to enable it; reminders scheduled only before due dates
- [ ] Tapping a notification opens the right item
- [ ] Update available → banner, Later snoozes 24 h, Update now downloads; major version → blocking screen; notification once per version

**Export**
- [ ] Filters (status, type, category, items, period, custom range) change the preview counts
- [ ] PDF and CSV open correctly; one row per transaction; local currency formatting

**UI and accessibility**
- [ ] Every control on every screen does something
- [ ] Dark + light theme, every palette, every text size, bold on/off — no overflow or clipping
- [ ] Back button behaviour; swipe-to-close sheets; toasts don't cover open sheets; FAB lifts above toasts
- [ ] Portrait lock on device; 360 px wide phone; reduced-motion setting respected

**Security (SEC-xx)**
- [ ] Row-level security: user A can never read or write user B's rows or files (test with two accounts)
- [ ] No secret keys in the client bundle or the repo; CSP blocks unexpected hosts
- [ ] OTP brute force limited (client lock + server rate limit); email enumeration doesn't leak account existence
- [ ] CSV formula injection (`=`, `+`, `-`, `@` prefixes) neutralised; user text escaped everywhere it's rendered
- [ ] Attachment type and size enforced; private storage paths scoped to the user

---

## 6. Definition of done (every change)

1. Built with no errors; no console errors in the preview.
2. Clicked through in a phone-sized preview — the new feature **and** the screens around it — in dark and light.
3. Test-case document updated.
4. Committed with a clear message; secrets not included.
5. Pushed; CI green; release or version number reported to me.
6. Reply lists: what changed (short), how to get it, and anything still pending on my side.
