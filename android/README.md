# Atrium for Android

A native Android app (Kotlin + Jetpack Compose, Material 3) for [Atrium](../README.md). It talks to the same
server as the web app, so accounts, files and sharing are the same on both.

**[Download the APK](https://github.com/amanjhacodes55/atrium/releases/download/android-v1.0.0/atrium-android-v1.0.0.apk)**
(Android 8.0+). Open it on your phone and allow installing from your browser when asked.

## What it does

- **Welcome**: try it without an account (a guest workspace with sample files), sign in, or create an account.
- **Drive**: Recent, Starred, My Drive (with folders and breadcrumbs), Shared and Trash tabs, search, pull to
  refresh and the storage you have used.
- **New**: a document, spreadsheet, presentation, notebook or folder, or upload files from the phone.
- **File actions**: open, share a link through the Android share sheet, turn a link off, rename, star, move,
  copy, download, trash, restore and delete forever.
- **PDF tools**: Merge, Split, Edit, Create (from photos or the camera), OCR, PDF to Word and Word to PDF, from
  the strip at the top of the drive. PDFs in the drive open in the PDF editor, and their menu has Split, OCR,
  Convert to Word and Merge.
- **Account**: who you are signed in as, storage, the server, and sign out.
- **Links**: tapping a share link or an editor link (`https://atrium-office.netlify.app/s/…`, `/docs/…`,
  `/pdf/…`) opens it in the app.

### How the editors and PDF tools work

Docs, Sheets, Slides, Notebook and the PDF tools are the web app's own pages, hosted full screen in a WebView,
so they never drift apart from the website. The PDF tools run entirely on the phone: files are read and
written in the page and are never uploaded, unless you tap *Save to Drive*. OCR downloads its language data
the first time you use a language.

The native side adds what a WebView can't do by itself:

- shares the session cookie with the native sign-in, so the editors open already signed in;
- a file picker that accepts several types at once (a PDF *or* a photo) and several files (Merge), and offers
  the camera wherever the page takes images, so you can scan a page straight into Create PDF or OCR;
- saves downloads, including files the page builds itself (`blob:` URLs such as an edited PDF or a .docx) to
  Downloads;
- routes the editors' *Print / Download as PDF* to Android printing;
- Back steps back through the page, then returns to the drive.

## Open in Android Studio

Open the `android/` folder (not the repository root) with **File > Open**. Android Studio creates
`local.properties` pointing at your SDK. You need JDK 17+ (Android Studio's bundled JBR works) and the
Android SDK platform 37.

## Build and install

```bash
cd android
./gradlew assembleDebug                      # app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug                       # onto a connected device or a running emulator
adb shell am start -n org.atrium.app/.MainActivity
```

If `java` isn't on your `PATH`, point `JAVA_HOME` at Android Studio's JDK, for example
`JAVA_HOME=~/android-studio/jbr ./gradlew assembleDebug`.

## Using your own server

The app uses `https://atrium-office.netlify.app` by default. To build it for a self-hosted Atrium, set
`atriumBaseUrl`, either once in `gradle.properties` or per build:

```bash
./gradlew assembleDebug -PatriumBaseUrl=https://office.example.com
```

That changes the API, the editor pages and the host name that links open in the app. The server must be
served over HTTPS, because Android blocks plain HTTP. Debug builds make one exception, `localhost`, so you can
try a local server on an emulator or a phone plugged in over USB:

```bash
adb reverse tcp:3000 tcp:3000                # the device's localhost:3000 is this computer's
./gradlew installDebug -PatriumBaseUrl=http://localhost:3000
```

## Code layout

```
app/src/main/java/org/atrium/app/
  AtriumApplication.kt      the app's single repository
  MainActivity.kt           Compose host: welcome, drive and account screens
  data/                     ApiClient (HttpURLConnection + org.json), models, repository
  ui/                       ViewModel, theme, the screens, item actions and the PDF tools strip
  editor/                   EditorActivity (the WebView) and the downloads bridge
```
