// Records "Atrium on Android": the native app on an emulator, against a local server with fresh demo
// data. Each beat is filmed with screenrecord, set in a phone frame on a 1080p slide, and narrated.
//
//   1. npm run build, docs/video/reset.sh, then
//        ATRIUM_DATA_DIR=$PWD/docs/video/build/data npx next start -p 3014
//   2. Boot an emulator (SERIAL, default emulator-5580), forward the port and install a build for it:
//        emulator -avd <avd> -port 5580 -no-window &
//        adb reverse tcp:3014 tcp:3014
//        (cd android && ./gradlew installDebug -PatriumBaseUrl=http://localhost:3014)
//   3. node docs/video/phone-demo.mjs
//
// Output: docs/media/atrium-android.mp4
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { find, hideKeyboard, longPress, nodes, record, shell, sleep, swipe, tap, tapAt, type } from "./phone.mjs";
import { launch, newContext } from "./rec.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, "build", "phone");
const MEDIA = path.join(HERE, "../media");
const PKG = "org.atrium.app";
const PYTHON = process.env.TTS_PYTHON || path.join(process.env.HOME, ".local/share/kokoro-tts/venv/bin/python");
const VOICE = process.env.VOICE || "af_heart";
const LEAD = 0.4, TAIL = 0.7;
fs.mkdirSync(path.join(BUILD, "voice"), { recursive: true });
fs.mkdirSync(MEDIA, { recursive: true });

const probe = (f) => Number.parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
function voice(text) {
  const key = crypto.createHash("sha1").update(`${VOICE}\n${text}`).digest("hex").slice(0, 12);
  const file = path.join(BUILD, "voice", key + ".wav");
  if (!fs.existsSync(file)) execFileSync(PYTHON, [path.join(HERE, "tts.py"), file], { input: text, env: { ...process.env, VOICE }, stdio: ["pipe", "ignore", "inherit"] });
  return { file, seconds: probe(file) };
}

// ---------------------------------------------------------------------------------------------
// Setup, off camera: files on the phone to pick from, a fresh app in a guest workspace, and OCR's
// language data downloaded once so recognising text on camera doesn't wait on it.

const browser = await launch();
const card = await (await newContext(browser, { deviceScaleFactor: 1 })).newPage(); // slides at exactly 1920x1080
await card.setViewportSize({ width: 1920, height: 1080 });

const FILES = path.join(BUILD, "files");
fs.mkdirSync(FILES, { recursive: true });
const paper = (body) => `<body style="margin:0;background:linear-gradient(135deg,#8a7a68,#5d5145);display:flex;align-items:center;justify-content:center;height:1200px"><div style="width:700px;height:1000px;background:#fbfaf6;box-shadow:0 20px 50px rgba(0,0,0,.45);transform:rotate(-1.2deg);padding:60px;box-sizing:border-box;font-family:Georgia,serif;color:#222">${body}</div></body>`;
const photos = {
  "scan-receipt.jpg": paper(`<h1 style="font-family:sans-serif;letter-spacing:2px;margin:0">CORNER CAFE</h1><p style="color:#666">12 Market Street · 30 Oct 2026</p><hr><table style="width:100%;font-size:26px;line-height:2">${[["Flat white", "3.80"], ["Croissant", "2.60"], ["Orange juice", "3.20"], ["Banana bread", "2.90"]].map(([a, c]) => `<tr><td>${a}</td><td style="text-align:right">${c}</td></tr>`).join("")}</table><hr><p style="font-size:32px;display:flex;justify-content:space-between"><b>Total</b><b>12.50</b></p><p style="margin-top:120px;text-align:center;color:#666;font-size:22px">Thank you, come again!</p>`),
  "scan-letter.jpg": paper(`<p style="font-size:24px;color:#555">Atrium Studio<br>30 October 2026</p><p style="font-size:30px;line-height:1.6;margin-top:50px">Dear team,</p><p style="font-size:30px;line-height:1.6">Thank you for a wonderful quarter. The new office suite shipped on time, and our customers love it.</p><p style="font-size:30px;line-height:1.6">Let us celebrate on Friday at five.</p><p style="font-size:30px;line-height:1.6;margin-top:60px">Warm regards,<br>Maya</p>`),
};
const pdfs = {
  "Q3-Report.pdf": ["Q3 Report", "Revenue grew 18% quarter on quarter, led by the new team plans.", "Highlights", "Churn fell to 2.1%. Three enterprise customers signed."],
  "Q3-Appendix.pdf": ["Appendix", "Tables and charts behind the Q3 report.", "Method", "Figures are unaudited and rounded to the nearest thousand."],
};
await card.setViewportSize({ width: 900, height: 1200 });
for (const [f, html] of Object.entries(photos)) {
  await card.setContent(html);
  await card.screenshot({ path: path.join(FILES, f), type: "jpeg", quality: 88 });
}
for (const [f, [h, s, h2, t]] of Object.entries(pdfs)) {
  await card.setContent(`<body style="font-family:sans-serif;padding:60px"><h1 style="font-size:48px;color:#1d4ed8">${h}</h1><p style="font-size:22px">${s}</p><h2>${h2}</h2><p style="font-size:18px">${t}</p></body>`);
  await card.pdf({ path: path.join(FILES, f), format: "A4" });
}
await card.setViewportSize({ width: 1920, height: 1080 });
// All in Download, so whichever folder the picker remembers, the files are there.
shell("rm -f /sdcard/Download/*.pdf /sdcard/Download/scan-*.jpg /sdcard/Pictures/scan-*.jpg");
for (const f of [...Object.keys(pdfs), ...Object.keys(photos)]) {
  execFileSync(process.env.ADB || `${process.env.HOME}/Android/Sdk/platform-tools/adb`, ["-s", process.env.SERIAL || "emulator-5580", "push", path.join(FILES, f), `/sdcard/Download/${f}`], { stdio: "ignore" });
  shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/${f} >/dev/null`);
}

/** Back to the drive: MainActivity is singleTask, so starting it closes the editor on top. */
async function drive() {
  shell(`am start -n ${PKG}/.MainActivity >/dev/null`);
  await find("My Drive", { timeout: 20000 });
  await sleep(800);
}

/** Picks files in the system picker: one with a tap, several with a long press and then Select. */
async function pick(names) {
  if (names.length === 1) {
    await tap(names[0], { exact: true, timeout: 20000 });
    return;
  }
  await longPress(names[0], { exact: true, timeout: 20000 });
  await sleep(500);
  for (const name of names.slice(1)) await tap(name, { exact: true });
  await sleep(400);
  await tap("Select", { exact: true });
}

shell(`pm clear ${PKG}`);
shell("settings put system show_touches 1");
shell(`am start -n ${PKG}/.MainActivity`);
await tap("Try it without an account", { timeout: 30000 });
await find("My Drive", { timeout: 30000 });
await tap("OCR", { exact: true });
await tap("Choose a scanned PDF or a photo", { timeout: 30000 });
await tap("Files", { exact: true });
await pick(["scan-letter.jpg"]);
await tap("Recognise text", { timeout: 20000 });
await find("Recognised text", { timeout: 600000 });
await drive();

// ---------------------------------------------------------------------------------------------
// Beats: a headline for the slide, the line that is spoken, and what happens on the phone.

const beats = [
  { title: "Atrium on Android", text: "Atrium has a native Android app: your documents, spreadsheets, slides and notebooks, in your pocket.", run: async () => {
    await sleep(1500);
    await swipe(540, 1700, 540, 1300, 900);
    await sleep(800);
    await swipe(540, 1300, 540, 1700, 900);
    await sleep(1000);
  } },
  { title: "Your whole drive", text: "Recent files, Starred, My Drive, Shared and Trash, with search and storage, just like on the web.", run: async () => {
    await tap("Recent", { exact: true });
    await sleep(1600);
    await tap("Starred", { exact: true });
    await sleep(1300);
    await tap("My Drive", { exact: true, last: true });
    await sleep(1500);
  } },
  { title: "Open and edit", text: "Open a file to edit it, with the same editors as the website, already signed in.", run: async () => {
    await tap("Team Handbook", { exact: true });
    await find("Saved", { timeout: 30000 });
    await sleep(1500);
    await swipe(540, 1900, 540, 1100, 700);
    await sleep(1500);
  } },
  { title: "Create on the go", text: "Start a new document, spreadsheet, presentation or notebook with a single tap, and just start typing.", prep: drive, run: async () => {
    await tap("New", { exact: true });
    await sleep(900);
    await tap("New document");
    await find("Start typing", { timeout: 30000 });
    await sleep(800);
    tapAt(600, 800);
    await sleep(600);
    await type("Trip plan", { wpm: 140 });
    shell("input keyevent KEYCODE_ENTER");
    await type("Flights are booked. Hotel next.", { wpm: 160 });
    await sleep(1500);
  } },
  { title: "Share a link", text: "Share any file with a link, through the apps already on your phone.", prep: drive, run: async () => {
    await tap("More actions for Team Handbook");
    await sleep(900);
    await tap(/^(Create share link|Share link)$/);
    await sleep(3000);
    shell("input keyevent KEYCODE_BACK");
    await sleep(800);
  } },
  { title: "PDF tools, built in", text: "And the PDF tools come with it. Merge a few PDFs: pick them, set the order, and save the result to your drive.", prep: drive, run: async () => {
    await tap("Merge", { exact: true });
    await tap("Choose PDF files", { timeout: 30000 });
    await pick(["Q3-Report.pdf", "Q3-Appendix.pdf"]);
    await find("Merge 2 PDFs", { timeout: 20000 });
    await sleep(1500);
    await tap("Merge 2 PDFs");
    await find("Save to Drive", { timeout: 30000 });
    await sleep(900);
    await tap("Save to Drive");
    await find("Saved to Drive", { timeout: 30000 });
    await sleep(1200);
  } },
  { title: "Photos to PDF", text: "Turn photos and scans into a PDF, from your gallery, or straight from the camera.", prep: drive, run: async () => {
    await tap("Create", { exact: true });
    await tap("Choose images", { timeout: 30000 });
    await sleep(900);
    await tap("Files", { exact: true });
    // Images only, so Android shows its photo picker: a grid of the newest photos, with no names.
    await find(/^Photo taken on/, { timeout: 20000 });
    await sleep(600);
    const photos = nodes().filter((n) => /^Photo taken on/.test(n.desc));
    for (const p of photos.slice(0, 2)) {
      tapAt(p.x, p.y);
      await sleep(600);
    }
    await tap("Done", { exact: true });
    await find(/^Create PDF \(2 pages\)$/, { timeout: 20000 });
    await sleep(1200);
    await tap(/^Create PDF \(2 pages\)$/);
    await find("Save to Drive", { timeout: 30000 });
    await sleep(1500);
  } },
  { title: "Read text with OCR", text: "OCR reads the text in a scan, right on the phone, and makes the PDF searchable. Nothing is uploaded.", prep: drive, run: async () => {
    await tap("OCR", { exact: true });
    await tap("Choose a scanned PDF or a photo", { timeout: 30000 });
    await sleep(700);
    await tap("Files", { exact: true });
    await pick(["scan-letter.jpg"]);
    await tap("Recognise text", { timeout: 20000 });
    await find("Recognised text", { timeout: 120000 });
    await sleep(600);
    await swipe(540, 1900, 540, 1100, 700);
    await sleep(2000);
  } },
  { title: "PDF to Word", text: "Any PDF in your drive converts to Word, or straight into an Atrium document you can edit.", prep: drive, run: async () => {
    await tap("More actions for Q3-Report-merged.pdf");
    await sleep(900);
    await tap("Convert to Word");
    await find("Read scanned pages with OCR", { timeout: 30000 });
    await sleep(800);
    await tap("Convert to Word", { exact: true, last: true });
    await tap("Open in Atrium Docs", { timeout: 30000 });
    await find("Saved", { timeout: 30000 });
    await sleep(2000);
  } },
];

// ---------------------------------------------------------------------------------------------
// Film each beat on the phone, and render its slide.

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const LOGO = `<svg viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#f1f2f5"/><rect x="6" y="6" width="9" height="9" rx="2.2" fill="#3b82f6"/><rect x="17" y="6" width="9" height="9" rx="2.2" fill="#22c55e"/><rect x="6" y="17" width="9" height="9" rx="2.2" fill="#f97316"/><rect x="17" y="17" width="9" height="9" rx="2.2" fill="#a855f7"/></svg>`;
async function slide(file, title, text, step, total) {
  await card.setContent(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=block" /><style>
    html,body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:Inter,sans-serif;color:#eef0f6;background:radial-gradient(ellipse at 75% 30%,#1c2540 0%,#12141a 55%,#0b0c10 100%)}
    .phone{position:absolute;left:300px;top:44px;width:452px;height:990px;border-radius:64px;background:#05060a;box-shadow:0 0 0 2px #2a3040,0 40px 80px rgba(0,0,0,.6)}
    .copy{position:absolute;left:900px;top:0;bottom:0;width:820px;display:flex;flex-direction:column;justify-content:center}
    .brand{display:flex;align-items:center;gap:14px;font-size:26px;font-weight:600;color:#c7d2fe}
    .brand svg{width:40px;height:40px}
    h1{font-size:72px;line-height:1.05;letter-spacing:-2px;margin:28px 0 0;font-weight:600}
    p{font-size:32px;line-height:1.45;color:#b4b9c8;margin:28px 0 0}
    .rule{width:90px;height:4px;border-radius:2px;background:linear-gradient(90deg,#3b82f6,#a855f7,#f97316);margin-top:30px}
    .step{position:absolute;left:900px;bottom:70px;font-size:20px;color:#7c8396;letter-spacing:2px}
  </style></head><body>
    <div class="phone"></div>
    <div class="copy">
      <div class="brand">${LOGO}Atrium for Android</div>
      <h1>${esc(title)}</h1>
      <div class="rule"></div>
      <p>${esc(text)}</p>
    </div>
    <div class="step">${String(step).padStart(2, "0")} / ${String(total).padStart(2, "0")}</div>
  </body></html>`, { waitUntil: "networkidle" });
  await card.screenshot({ path: file });
}

// A rounded-corner mask for the phone screen (1080x2424 scaled to 428x960).
const MASK = path.join(BUILD, "mask.png");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=428x960", "-vf", "format=gray,geq=lum='if(gt(abs(X-214)\\,214-52)*gt(abs(Y-480)\\,480-52)\\,if(lte(hypot(abs(X-214)-(214-52)\\,abs(Y-480)-(480-52))\\,52)\\,255\\,0)\\,255)'", "-frames:v", "1", MASK]);

const clips = [];
for (const [i, b] of beats.entries()) {
  if (b.prep) await b.prep();
  const vo = voice(b.text);
  const want = LEAD + vo.seconds + TAIL;
  const raw = path.join(BUILD, `raw${String(i).padStart(2, "0")}.mp4`);
  const rec = record(raw);
  await sleep(700); // screenrecord takes a moment to start
  const started = Date.now();
  try {
    await b.run();
  } catch (e) {
    console.warn(`beat ${i}:`, e.message);
  }
  const left = want - (Date.now() - started) / 1000;
  if (left > 0) await sleep(left * 1000);
  const filmed = await rec.stop();
  hideKeyboard();
  const bg = path.join(BUILD, `slide${i}.png`);
  await slide(bg, b.title, b.text, i + 1, beats.length);
  // Driving the phone is slow (each look at the screen is a uiautomator dump), so the footage has long
  // still stretches. Keep one frame in four while nothing changes, then speed up a little more if it
  // still runs past the voice, and hold the last frame if it is shorter.
  const tight = path.join(BUILD, `tight${String(i).padStart(2, "0")}.mp4`);
  // screenrecord only writes a frame when the screen changes, so first stretch the clip to the time it was
  // filmed for (a beat where nothing moves is a single frame), then skip its warm-up.
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", `tpad=stop_mode=clone:stop_duration=${filmed.toFixed(2)},fps=30,trim=start=0.6:duration=${(filmed - 0.6).toFixed(2)},setpts=PTS-STARTPTS,mpdecimate=max=3,setpts=N/30/TB`, "-r", "30", "-an", "-c:v", "libx264", "-crf", "12", tight]);
  if (!probe(tight)) {
    // Nothing usable was filmed (screenrecord saves no frames for a screen that never changes): show it still.
    const still = path.join(BUILD, `still${String(i).padStart(2, "0")}.png`);
    fs.writeFileSync(still, execFileSync(process.env.ADB || `${process.env.HOME}/Android/Sdk/platform-tools/adb`, ["-s", process.env.SERIAL || "emulator-5580", "exec-out", "screencap", "-p"], { maxBuffer: 64 << 20 }));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", still, "-t", want.toFixed(2), "-r", "30", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", tight]);
  }
  const kept = probe(tight) || 0; // a beat where nothing moves can come out a frame or two long, with no duration
  const speed = Math.min(Math.max(kept / want, 1), 1.5);
  const seconds = Math.max(want, kept / speed);
  const out = path.join(BUILD, `beat${String(i).padStart(2, "0")}.mp4`);
  // Phone video scaled into the frame on the slide.
  execFileSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", bg, "-i", tight, "-i", MASK, "-filter_complex",
    `[1:v]setpts=PTS/${speed.toFixed(3)},fps=30,tpad=stop_mode=clone:stop_duration=${seconds.toFixed(2)},scale=428:960,format=rgba[ph];[2:v]format=gray[m];[ph][m]alphamerge[phm];[0:v][phm]overlay=312:59:shortest=0,format=yuv420p[v]`,
    "-map", "[v]", "-t", seconds.toFixed(2), "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "17", out]);
  clips.push({ out, vo, seconds: probe(out) });
  console.log(`beat ${i}: ${clips.at(-1).seconds.toFixed(1)}s (voice ${vo.seconds.toFixed(1)}s)`);
}

// Outro: the same card as the main demo, pointing at the APK.
const outroText = "Download the app from the GitHub releases page. It's free and open source, like the rest of Atrium.";
{
  const vo = voice(outroText);
  const bg = path.join(BUILD, "outro.png");
  await card.setContent(fs.readFileSync(path.join(HERE, "outro.html"), "utf8").replace("One click to Netlify, or self-host with Docker", "Android app: github.com/amanjhacodes55/atrium/releases"), { waitUntil: "load" });
  await card.evaluate(() => document.body.classList.add("in")); // the card's text fades in on this class
  await sleep(1200);
  await card.screenshot({ path: bg });
  const out = path.join(BUILD, "beat99.mp4");
  const seconds = LEAD + vo.seconds + TAIL + 0.6;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", bg, "-t", seconds.toFixed(2), "-r", "30", "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "17", out]);
  clips.push({ out, vo, seconds: probe(out) });
}
await browser.close();

// Join the clips and lay the voice over them.
const list = path.join(BUILD, "clips.txt");
fs.writeFileSync(list, clips.map((c) => `file '${c.out}'`).join("\n"));
const total = clips.reduce((s, c) => s + c.seconds, 0);
const args = ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list];
const graph = [];
let t = 0;
clips.forEach((c, i) => {
  args.push("-i", c.vo.file);
  graph.push(`[${i + 1}:a]aresample=48000,adelay=${Math.round((t + LEAD) * 1000)}:all=1[a${i}]`);
  t += c.seconds;
});
graph.push(`${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0,highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=180,aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5,aresample=48000,apad,atrim=0:${total.toFixed(3)}[a]`);
graph.push(`[0:v]fade=t=in:d=0.5,fade=t=out:st=${(total - 0.9).toFixed(3)}:d=0.9[v]`);
const out = path.join(MEDIA, "atrium-android.mp4");
execFileSync("ffmpeg", [...args, "-filter_complex", graph.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
console.log(`done: ${out} (${total.toFixed(1)}s)`);
