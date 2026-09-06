# Building the APK locally (doc 09 §4, lapis 3)

There is no Play Store in this product and no EAS account. The APK is built on a
workstation with Gradle and handed to the handsets directly, so the signing key
is not a formality — it is the only thing that decides whether a phone will
accept an update.

## What the build machine needs

| Requirement | Version | Notes |
|---|---|---|
| JDK | 17 or 21 | Expo documents 17. Android Studio ships a JBR at `C:\Program Files\Android\Android Studio\jbr` — 21 there builds this project fine. |
| Android SDK | Platform 36 + any build-tools | Already present if Android Studio is installed. |
| **SDK CMake** | **3.31.6** | **Required on Windows — see below.** Not installed by default. |
| Node | 22 | Same as the backend. |

Set these before any Gradle command (PowerShell):

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

### CMake 3.31.6 is not optional on Windows

```powershell
& "$env:ANDROID_HOME\cmdline-tools\latest\bin\android.exe" sdk install cmake/3.31.6
```

AGP defaults to CMake 3.22.1, which bundles **ninja 1.10**. That ninja refuses
any path over 260 characters with `Filename longer than 260 characters` —
its own check, not the operating system's, so it fails even though this machine
already has `LongPathsEnabled=1`.

React Native's codegen mirrors each source file's absolute path into the object
file's path, which puts one `react-native-gesture-handler` shadow node at **293
characters relative to the build directory** — already over the limit before any
project path is prepended. So moving the project somewhere shorter does not
help; only a newer ninja does. ninja 1.12 lifted the limit and ships with SDK
CMake 3.30+; 3.22.1 was never back-patched.

`plugins/withCmakeVersion.js` pins the version so the build cannot silently fall
back to the broken one.

## One-time: create the release keystore

Run this yourself. The password must not pass through a chat transcript, a
commit, or a CI log.

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v -storetype PKCS12 -keystore sru-field-release.keystore -alias sru-field -keyalg RSA -keysize 4096 -validity 10000
```

Then put the keystore **outside this repository** — `C:\keystores\` or a
password manager's file vault — and record the credentials in
`~/.gradle/gradle.properties` (that is `C:\Users\<you>\.gradle\gradle.properties`),
which is per-machine and never committed:

```properties
SRU_RELEASE_STORE_FILE=C:/keystores/sru-field-release.keystore
SRU_RELEASE_STORE_PASSWORD=...
SRU_RELEASE_KEY_ALIAS=sru-field
SRU_RELEASE_KEY_PASSWORD=...
```

### Back the keystore up in two places, today

Android identifies an app by its signing key. If this keystore is lost, no
future APK can update the installed one — every handset has to **uninstall**
first, and uninstalling deletes the local SQLite database, **including records
that are still PENDING_SYNC**. Losing the key is therefore a data-loss event for
any shift that happens to be offline at the time, not just an inconvenience.

Back it up alongside the VPS `.env.field` secrets.

### A PKCS12 keystore has no separate key password

`keytool -genkeypair -storetype PKCS12` produces a **PKCS12** store, and the
format has no concept of a per-key password: the private key is encrypted with
the *store* password. Passing a different `-keypass` does not fail — keytool
accepts it and quietly ignores it.

So `SRU_RELEASE_KEY_PASSWORD` **must equal** `SRU_RELEASE_STORE_PASSWORD`. If it
does not, everything looks fine for four minutes and then the very last task
fails:

```
Execution failed for task ':app:packageRelease'.
> KeytoolException: Failed to read key sru-field from store "...":
  Get Key failed: Given final block not properly padded.
```

"Store opened, key would not decrypt" is the signature of exactly this. Note
that `keytool -list` and even `keytool -certreq` accept **either** password for
a PKCS12 store, so they cannot be used to diagnose it — AGP goes through the
JCA `KeyStore` API, which does not ignore the key password.

## Building

```powershell
npx expo prebuild --platform android --clean
cd android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a
```

The APK lands at `android/app/build/outputs/apk/release/app-release.apk`.

### Do not drop the `-PreactNativeArchitectures` flag

A default build packages four sets of native libraries. Two of them — `x86` and
`x86_64` — exist for emulators and are **54MB of a 127MB APK**. No handset in
the plant runs them, and that weight is paid again by every phone on every
release, over the plant's own network (doc 09 §4, lapis 3).

The flag is React Native's own mechanism and it also skips *compiling* the
unused architectures, so the build is faster too. Setting `abiFilters` in the
`release` build type instead does **not** work here: it left all four ABIs in
the APK.

If a release APK ever comes out at ~120MB, this flag was forgotten.

For a quick check on the emulator, build debug — it keeps every ABI, so it
installs on the standard x86_64 emulator, and it needs no release key:

```powershell
.\gradlew.bat assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

A **release** APK built with the flag above will not install on an x86_64
emulator. That is expected; test release builds on a real handset.

### Why `--clean`, and why `android/` is not committed

`android/` is generated and gitignored. Every customisation lives in `app.json`
or in `plugins/`, because `prebuild --clean` deletes the directory and rebuilds
it — anything edited by hand in there disappears without a trace on the next
build. This is Expo's documented model.

`plugins/withReleaseSigning.js` is the one that matters: the prebuild template
signs **release** builds with Android's public debug key (password `android`),
which would let anyone build an APK that installs straight over ours as an
update. The plugin repoints release signing at the real keystore and makes a
release build **fail** when the key is missing, rather than quietly producing a
debug-signed APK that looks completely normal until it is too late.

If the template ever changes, prebuild fails with a message naming the plugin.
Fix the plugin — do not work around it by editing `build.gradle`.

## Before every release build

1. Bump `expo.version` (semantic) **and** `expo.android.versionCode` (+1) in
   `app.json`. Android refuses to install an APK whose `versionCode` is not
   higher than the installed one, so a forgotten bump looks like "the update
   did not work" on every handset.
2. Confirm `expo.extra.apiUrl` is `https://ops.sruipal.com` — a build pointing
   at a local server still runs perfectly and quietly writes a whole shift of
   records somewhere nobody will look. Settings shows a red warning when the
   build is pointed at a local server; check it after installing.
3. `npm run lint && npm run typecheck && npx jest`.
4. Set both env vars in the shell — neither is inherited from Android Studio:
   `$env:JAVA_HOME` and `$env:ANDROID_HOME` (see Prerequisites). Missing
   `ANDROID_HOME` fails early with "SDK location not found", because
   `prebuild --clean` deletes `local.properties` along with the rest of
   `android/`.

### Always `prebuild --clean`, and check the built bundle

Gradle fingerprints the JS bundle task on **files**, not on environment. Change
`EXPO_PUBLIC_API_URL` and rebuild without cleaning and you get:

```
> Task :app:createBundleReleaseJsAndAssets UP-TO-DATE
```

— an APK carrying the *previous* bundle, pointing at the *previous* server,
with nothing in the build output suggesting anything is wrong. `prebuild
--clean` avoids it by deleting `android/` outright, which is why the build
recipe starts there and why skipping it to save a few minutes is a false
economy.

Do not trust that from memory. Read the URL out of the APK you are about to
hand over:

```powershell
python -c "import zipfile,re; d=zipfile.ZipFile(r'app\build\outputs\apk\release\app-release.apk').read('assets/index.android.bundle'); print('ops.sruipal.com:', len(re.findall(rb'ops\.sruipal\.com', d)), '| localhost:', len(re.findall(rb'127\.0\.0\.1', d)))"
```

A shippable APK has at least one `ops.sruipal.com` and zero `127.0.0.1`. This
takes a second and is the only check that looks at the artifact itself rather
than at the source it was supposed to be built from.

## Installing on a handset

```powershell
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

`-r` reinstalls in place and **keeps the local database**, which is the whole
point of getting the signing key right. It only works when the new APK is signed
with the same key as the installed one; if it fails with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the keys differ — stop and work out which
key is correct rather than uninstalling, because uninstalling discards unsent
records.

Verify what actually signed a built APK:

```powershell
& "$env:ANDROID_HOME\build-tools\37.0.0\apksigner.bat" verify --print-certs app-release.apk
```

## Publishing the build

Once the APK is installed on a handset and works, cut a GitHub release. The
server watches for it and publishes the build to the handsets on its own — there
is no 67MB browser upload any more.

```powershell
Copy-Item android\app\build\outputs\apk\release\app-release.apk ..\releases\sru-field-0.4.0.apk
gh release create v0.4.0 ..\releases\sru-field-0.4.0.apk --title "SRU Field 0.4.0" --notes "..."
```

Two rules, and both are checked by the server rather than trusted:

- **The tag is `v` + `expo.version`, exactly.** `v0.4.0`, not `0.4.0` and not
  `v0.4`. The tag is the only version source the server consults.
- **The asset is named `sru-field-<expo.version>.apk`.** The gradle output is
  always `app-release.apk`, so the rename is not optional. An asset whose name
  disagrees with the tag is refused — the server will not store a build under a
  version it had to guess at.

Drafts and prereleases are ignored, so a draft release is a safe place to write
release notes before publishing.

`gh` is not installed on the build machine by default (`winget install
GitHub.cli`). Without it, the repo's Releases → *Draft a new release* page does
the same job: create the tag `v0.4.0`, drag in the renamed APK, publish. The two
rules above apply exactly the same way — the server cannot tell which route the
release came from.

**Check Devices in the admin web afterwards.** A release that breaks either rule
is *ignored*, not rejected loudly: GitHub shows a green 200 delivery and nothing
appears on the server. The delivery body in the repo's Settings → Webhooks →
Recent Deliveries says which rule it fell foul of (`ignored: "no_asset"` is a
name that does not match the tag). The admin upload form still works and is the
fallback for anything the webhook will not take.

## Permissions

`app.json` blocks five permissions that native dependencies pull in but this
app does not use: `CAMERA`, `RECORD_AUDIO`, `READ/WRITE_EXTERNAL_STORAGE` and
`SYSTEM_ALERT_WINDOW`. They arrive via `expo-camera`, which is installed ready
for Phase 3 but not yet used, and an APK that asks an operator for the
microphone is a question plant IT is right to ask about.

**Phase 3 must remove `android.permission.CAMERA` from `blockedPermissions`**
when the photo feature lands, or the camera will fail at runtime with a
permission denial that looks like a bug in the camera code.
