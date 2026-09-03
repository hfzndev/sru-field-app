# sru-field-app

Android app for **SRU field operators** — offline-first capture of tank levels,
activities and cleaning at the sulfur IPAL in Cilacap.

Built against `../sru-field-docs` (v1.1) and the API in `../sru-field-api`. The
documents are the source of truth; where this code and those documents disagree,
the documents win.

Phase 2 scope is **login, the midband calculator, and the sync engine**.
Activities and cleaning arrive in Phase 3, maintenance and in-app APK update in
Phase 4 (doc 01 §9).

## Requirements

Node 22+, and the Android SDK for building or running on a device.

## Run

```bash
npm install
npm start          # Metro; press "a" for Android
npm run web        # renders in a browser — useful for layout, not for SQLite
npm run typecheck
npm run lint
```

The web target is a convenience for checking layout quickly. It is not a
substitute for a device: the native modules this app depends on — SQLite,
SecureStore, the camera — behave differently or not at all there.

## Design rules that are not negotiable

These come from doc 03 §1 and doc 02 §1.1, and they exist because of who uses
this and where:

- **Nothing tappable under 44pt, no text under 16pt.** Operators use this with
  gloves on, in daylight, on cheap handsets. Secondary text is distinguished by
  colour and weight, never by shrinking it.
- **Tank codes are always written in full** — `93T-401`, never `T-401`. The two
  tanks sit next to each other and an abbreviation invites measuring the wrong
  one.
- **Indonesian labels throughout.** Code and API stay English; anything an
  operator reads is Indonesian.
- **Times display in WIB**, pinned to Asia/Jakarta rather than the device
  timezone — these phones are shared and nobody checks their settings.
- **Light theme only.** The app is used outdoors more than in a control room.

## Structure

```
app/
  login.tsx           shift account + password (the only screen needing signal)
  shift-start.tsx     shift slot + operator name
  (tabs)/
    index.tsx         dashboard, unsent count
    tanks/            list → history → measure
    sync.tsx          status and manual sync
  settings.tsx        version, switch account
components/ui.tsx     shared primitives; touch/type floors enforced here
constants/theme.ts    design tokens
lib/format.ts         WIB display, mm formatting
```

## Testing the offline behaviour

Until the sync engine lands (task 5), `../sru-field-api/tools/operator-sim.js`
is the reference implementation of the protocol this app will speak — including
the tape-length suggestion, which is ported from there rather than reinvented.
