# sru-field-app

Android app for **SRU field operators** — offline-first capture of tank levels,
activities and cleaning at the sulfur IPAL in Cilacap.

Built against `../sru-field-docs` (v1.2) and the API in `../sru-field-api`. The
documents are the source of truth; where this code and those documents disagree,
the documents win.

Phase 2 scope is **login, the midband calculator, and the sync engine**.
Activities and cleaning arrive in Phase 3, maintenance and in-app APK update in
Phase 4 (doc 01 §9).

## Requirements

Node 22+, and the Android SDK for building or running on a device.

Building a release APK additionally needs SDK **CMake 3.31.6** — the default
3.22.1 cannot build this project on Windows. See
[`docs/APK-BUILD.md`](docs/APK-BUILD.md), which also covers the release keystore
and why losing it costs unsent field records.

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

## Emulator

An AVD named `sru-field` is set up locally: Android 14 (API 34), 1080×2340,
2GB RAM. The specification is deliberately modest — doc 01 §6 says these ship to
cheap handsets, and testing on an over-specced emulator hides the jank an
operator would actually hit.

```bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
"$ANDROID_HOME/emulator/emulator.exe" -avd sru-field -no-boot-anim &
adb wait-for-device
npm start          # then press "a"
```

To recreate it from nothing (needs `cmdline-tools` in the SDK):

```bash
android sdk install "system-images/android-34/google_apis/x86_64"
avdmanager create avd -n sru-field -k "system-images;android-34;google_apis;x86_64" -d pixel_5
```

Useful while testing:

```bash
adb exec-out screencap -p > shot.png    # screenshot
adb shell svc wifi disable              # simulate losing signal
adb shell svc data disable
```

The emulator runs Expo Go, which covers every module in this app's dependency
list. A custom dev client is only needed if a package outside the Expo SDK is
added later.

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
