// Records the Atrium walkthrough: real clicks in the running app, narrated by Kokoro, with small
// one-line captions burned in. The live-editing beats are split screen: two browsers, two people.
//
//   1. npm run build, then docs/video/reset.sh (an empty data folder in build/)
//   2. ATRIUM_DATA_DIR=$PWD/docs/video/build/data npx next start -p 3013
//   3. node docs/video/demo.mjs   (TTS_PYTHON / VOICE optional, see tts.py; ONLY=n stops after beat n)
//
// Output: docs/media/atrium-demo.mp4 (captions burned in); the .srt goes to build/.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, launch, newContext, pointer, sleep, startRecording } from "./rec.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, "build");
const MEDIA = path.join(HERE, "../media");
const LEAD = 0.35; // beat starts, then the voice comes in
const TAIL = 0.6; // breathing room after a line before the next beat
// Python with kokoro-onnx installed (see tts.py); VOICE picks the Kokoro voice.
const PYTHON = process.env.TTS_PYTHON || path.join(process.env.HOME, ".local/share/kokoro-tts/venv/bin/python");
const VOICE = process.env.VOICE || "af_heart";
fs.mkdirSync(path.join(BUILD, "voice"), { recursive: true });
fs.mkdirSync(MEDIA, { recursive: true });

function voice(text, caption = text) {
  const key = crypto.createHash("sha1").update(`${VOICE}\n${text}`).digest("hex").slice(0, 12);
  const file = path.join(BUILD, "voice", key + ".wav");
  if (!fs.existsSync(file)) execFileSync(PYTHON, [path.join(HERE, "tts.py"), file], { input: text, env: { ...process.env, VOICE }, stdio: ["pipe", "ignore", "inherit"] });
  return { file, seconds: probe(file), cues: cues(caption, file) };
}
const probe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

// ---------------------------------------------------------------------------------------------
// Captions: one short line at a time. A line is split into phrases that fit, and each break is
// snapped to the pause the voice actually takes there, so the text changes when the speaker breathes.

const MAX_CHARS = 44;

function phrases(text) {
  // Break after punctuation first, then pack words so no caption runs past MAX_CHARS.
  const parts = text.match(/[^,.:;!?]+[,.:;!?]*\s*/g).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const last = out.at(-1);
    if (last && !/[.:;!?]$/.test(last) && last.length + 1 + p.length <= MAX_CHARS) out[out.length - 1] = `${last} ${p}`;
    else if (p.length <= MAX_CHARS) out.push(p);
    else out.push(...split(p));
  }
  return out;
}

// Halve an over-long phrase where a reader would pause: before a joining word, never after an article.
const JOIN = new Set(["and", "or", "but", "so", "with", "to", "that", "for", "in", "on", "right", "all", "then"]);
const STICKY = new Set(["a", "an", "the", "to", "of", "your", "its", "their"]);
function split(p) {
  if (p.length <= MAX_CHARS) return [p];
  const w = p.split(" ");
  let best = 1, score = Infinity;
  for (let i = 1; i < w.length; i++) {
    const left = w.slice(0, i).join(" "), right = w.slice(i).join(" ");
    let sc = Math.abs(left.length - right.length) + 20 * (Math.max(left.length, right.length) > MAX_CHARS);
    if (JOIN.has(w[i].toLowerCase())) sc -= 12;
    if (STICKY.has(w[i - 1].toLowerCase())) sc += 40;
    if (sc < score) { score = sc; best = i; }
  }
  return [...split(w.slice(0, best).join(" ")), ...split(w.slice(best).join(" "))];
}

function pauses(file) {
  const log = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "silencedetect=n=-38dB:d=0.12", "-f", "null", "-"]).stderr.toString();
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => ({ s, e: ends[i] ?? s })).filter((p) => p.e > p.s);
}

function cues(text, file) {
  const lines = phrases(text);
  const total = probe(file);
  const gaps = pauses(file);
  const chars = lines.reduce((n, l) => n + l.length, 0);
  let acc = 0, start = 0;
  return lines.map((line, i) => {
    acc += line.length;
    let end = i === lines.length - 1 ? total : (acc / chars) * total;
    if (i < lines.length - 1) {
      const near = gaps.filter((g) => Math.abs((g.s + g.e) / 2 - end) < 0.7).sort((a, b) => Math.abs((a.s + a.e) / 2 - end) - Math.abs((b.s + b.e) / 2 - end))[0];
      if (near) end = near.s + 0.05;
    }
    const cue = { line, start, end };
    start = end;
    return cue;
  });
}

// ---------------------------------------------------------------------------------------------
// Setup (not recorded): Priya's guest workspace, Sam's browser, and the outro card.

const browser = await launch();
// Split-screen browsers: each fills one 960x1080 half of the frame, just wide enough for an A4 page.
const HALF = { viewport: { width: 960, height: 1080 }, deviceScaleFactor: 1 };
/** The name other people see by your cursor, as if you had typed it on the link. */
const named = async (ctx, name) => {
  await ctx.addInitScript((n) => localStorage.setItem("atrium-live-name", n), name);
  return ctx;
};

const landingCtx = await newContext(browser);
const app = await landingCtx.newPage();
await app.goto(`${BASE}/`);
await app.waitForLoadState("networkidle");
await named(landingCtx, "Priya");

// Priya's second window, for the split screen, signed in to the same workspace.
const priyaCtx = await named(await newContext(browser, HALF), "Priya");
const left = await priyaCtx.newPage();
const samCtx = await named(await newContext(browser, HALF), "Sam");
const right = await samCtx.newPage();

const card = await (await newContext(browser)).newPage();
await card.setContent(fs.readFileSync(path.join(HERE, "outro.html"), "utf8"), { waitUntil: "load" });

const A = pointer(app), L = pointer(left), R = pointer(right);
let handbook = null;
let link = null;

/** A small name tag in the corner, so it's clear whose screen is whose. */
async function tag(page, text, color) {
  await page.evaluate(({ text, color }) => {
    document.getElementById("__tag")?.remove();
    const t = document.createElement("div");
    t.id = "__tag";
    t.textContent = text;
    t.style.cssText = `position:fixed;left:18px;bottom:44px;z-index:2147483640;padding:8px 16px;border-radius:999px;background:${color};color:#fff;font:600 22px/1.2 Inter,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:none`;
    document.body.append(t);
  }, { text, color });
}

/** The end of a paragraph's last line, where a click leaves the caret at the very end. */
async function clickEnd(P, page, loc) {
  const b = await loc.boundingBox();
  await P.moveTo(b.x + b.width - 4, b.y + b.height - 8);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.press("End");
  await sleep(200);
}

async function scrollDocTo(page, P, y, ms = 1600) {
  const now = await page.evaluate(() => document.querySelector(".page-flow").closest(".overflow-auto").scrollTop);
  await P.scroll(y - now, ms);
}

// ---------------------------------------------------------------------------------------------
// Beats: one or two sentences each, with the actions that happen while they're spoken. A beat with
// `split` records Priya on the left and Sam on the right at the same time.

const beats = [
  { page: app, text: "This is Atrium: a free, open-source office suite. Docs, Sheets, Slides, Drive and Notebook, in one workspace you can host yourself.", run: async () => {
    await sleep(700);
    await A.hover(app.getByRole("heading", { level: 1 }), { dx: 0.7, dy: 0.7, ms: 1300 });
    await sleep(900);
    await A.scroll(640, 2400);
    await sleep(1200);
    await A.moveTo(980, 520, 1000);
    await A.scroll(-640, 1600);
  } },
  { page: app, text: "Try it without an account, and you get a workspace with sample files. Search everything, or start something new from a template.", run: async () => {
    await A.click(app.getByRole("button", { name: /without an account/ }).first());
    await app.waitForURL(/\/home/);
    await app.waitForLoadState("networkidle");
    await sleep(900);
    await A.hover(app.getByRole("textbox", { name: "Search all your files" }), { dx: 0.3, ms: 900 });
    await sleep(500);
    await A.hover(app.getByText("Start something new"), { dx: 0.3, ms: 800 });
    for (const t of ["Blank document", "Meeting notes", "Monthly budget", "Pitch deck"]) {
      await A.hover(app.getByRole("button", { name: t }), { dy: 0.4, ms: 450 });
      await sleep(250);
    }
  } },
  { page: app, text: "Docs is a word processor with real pages. Text flows from one page to the next, line by line, the way it does in Word.", run: async () => {
    await A.click(app.getByRole("link", { name: /Team Handbook/ }).first());
    await app.waitForURL(/\/docs\//);
    await app.waitForSelector(".page-sheet");
    handbook = app.url().split("/docs/")[1];
    await sleep(1000);
    await A.moveTo(1100, 520, 700);
    // Down to the bottom of page one and the top of page two.
    const y = await app.evaluate(() => document.querySelectorAll(".page-sheet")[1].offsetTop - 330);
    await scrollDocTo(app, A, y, 3000);
    await sleep(900);
    await A.hover(app.locator(".page-number").first(), { ms: 800 });
    await sleep(600);
    await A.moveTo(330, 830, 900);
  } },
  { page: app, text: "To write it together, click Share, open the link to anyone, and make them an editor. Viewers can watch, editors can type. Then send the link.", run: async () => {
    await A.click(app.getByRole("button", { name: "Share" }));
    await sleep(500);
    const access = app.getByRole("combobox", { name: "Who can open the link" });
    await A.hover(access, { dx: 0.3, ms: 700 });
    await access.selectOption("anyone");
    await app.waitForSelector('select[aria-label="Link role"]');
    await sleep(800);
    const role = app.getByRole("combobox", { name: "Link role" });
    await A.hover(role, { dx: 0.4, ms: 700 });
    await role.selectOption("edit");
    await sleep(900);
    await A.click(app.getByRole("button", { name: /Copy link/ }));
    link = await app.getByRole("textbox", { name: "Link" }).inputValue();
    await sleep(800);
    await A.click(app.getByRole("button", { name: "Close" }));
  } },
  {
    split: [left, right],
    // Not recorded: Priya's full-size window leaves the document, and the two halves open it.
    setup: async () => {
      await app.goto(`${BASE}/home`);
      await priyaCtx.addCookies(await landingCtx.cookies());
      await left.goto(`${BASE}/docs/${handbook}`);
      await right.goto(link);
      await Promise.all([left.waitForSelector(".page-sheet"), right.waitForSelector(".page-sheet")]);
      await sleep(2500);
      await tag(left, "Priya · owner", "#2563eb");
      await tag(right, "Sam · opened the link", "#16a34a");
    },
    text: "Sam opens the link, with no account. We each see the other's cursor and name, and every word appears as it's typed.",
    run: async () => {
      await sleep(600);
      await L.hover(left.locator(".ProseMirror h1"), { dx: 0.9, ms: 900 });
      await clickEnd(R, right, right.locator(".ProseMirror p").nth(2));
      await sleep(400);
      await R.type(" Every team writes its own page here.", { cps: 14 });
      await sleep(600);
    },
  },
  {
    split: [left, right],
    text: "We can both type at the same time, even in the same paragraph. Edits merge without conflicts, and save on their own.",
    run: async () => {
      await clickEnd(L, left, left.locator(".ProseMirror p").nth(2));
      await Promise.all([
        L.type(" Keep it short.", { cps: 12 }),
        (async () => {
          await clickEnd(R, right, right.locator(".ProseMirror p").nth(1));
          await R.type(" Questions go in the team channel.", { cps: 13 });
        })(),
      ]);
      await sleep(600);
    },
  },
  {
    split: [left, right],
    text: "Page setup is shared too. Change the margins, and everyone's pages reflow together, without anyone reloading.",
    run: async () => {
      await L.click(left.getByText("File", { exact: true }));
      await L.click(left.getByRole("menuitem", { name: /Page setup/ }));
      await sleep(300);
      const margins = left.locator("select").filter({ hasText: "Narrow" });
      await L.hover(margins, { dx: 0.4, ms: 700 });
      await margins.selectOption("narrow");
      await sleep(500);
      await L.click(left.getByRole("button", { name: "Done" }));
      await sleep(900);
      await R.moveTo(560, 700, 900);
    },
  },
  { page: app, setup: async () => {
    await left.goto("about:blank");
    await right.goto("about:blank");
    await app.reload();
    await app.waitForLoadState("networkidle");
  }, text: "Sheets has about four hundred Excel formulas, number formats, and tabs, and it opens and saves Excel files.", run: async () => {
    await A.click(app.getByRole("link", { name: /Budget 2026/ }).first());
    await app.waitForURL(/\/sheets\//);
    await sleep(900);
    const avg = app.locator("[data-cells] div", { hasText: /^Average$/ }).first();
    const b = await avg.boundingBox();
    await A.moveTo(b.x + 40, b.y + b.height * 1.5 + 24, 900);
    await app.mouse.down();
    await app.mouse.up();
    await A.type("Next year", { cps: 14 });
    await app.keyboard.press("Tab");
    await sleep(200);
    await A.type("=F8*1.08", { cps: 10 });
    await app.keyboard.press("Enter");
    await sleep(900);
    await A.hover(app.getByRole("button", { name: "Sales" }).first(), { ms: 900 });
  } },
  { page: app, text: "Slides builds decks with themes, images, and speaker notes. Present full screen, and move through the slides with the arrow keys.", run: async () => {
    await A.click(app.getByRole("button", { name: "Apps" }));
    await A.click(app.getByRole("link", { name: "Slides" }).first());
    await app.waitForURL(/\/slides$/);
    await sleep(500);
    await A.click(app.getByText("Atrium Pitch Deck").first());
    await app.waitForURL(/\/slides\//);
    await sleep(1200);
    await A.click(app.getByRole("button", { name: /Present/ }).first());
    await sleep(1500);
    await app.keyboard.press("ArrowRight");
    await sleep(1300);
    await app.keyboard.press("ArrowRight");
    await sleep(1200);
    await app.keyboard.press("Escape");
  } },
  { page: app, text: "Drive keeps everything in folders, with previews, search, and stars. It lists what you've shared, and what's been shared with you.", run: async () => {
    await A.click(app.getByRole("button", { name: "Apps" }));
    await A.click(app.getByRole("link", { name: "Drive" }).first());
    await app.waitForURL(/\/drive/);
    await sleep(700);
    await A.click(app.getByRole("button", { name: "Projects", exact: true }), { dx: 0.2 });
    await sleep(900);
    await A.click(app.getByRole("button", { name: "Shared by me" }));
    await sleep(900);
    await A.click(app.getByRole("button", { name: "Shared with me" }));
    await sleep(700);
  } },
  { page: app, text: "There's a dark mode, and nothing is locked in. Open a Word, Excel, or PowerPoint file, edit it, and download it again in the same format.", run: async () => {
    await A.click(app.getByRole("button", { name: "My Drive" }));
    await sleep(500);
    await A.click(app.getByRole("button", { name: "Use dark theme" }));
    await sleep(1200);
    await A.click(app.getByRole("button", { name: "Apps" }));
    await A.click(app.getByRole("link", { name: "Docs" }).first());
    await app.waitForURL(/\/docs$/);
    await sleep(700);
    await A.hover(app.getByRole("button", { name: /Open a Word file/ }), { dx: 0.4, ms: 900 });
  } },
  { page: card, text: "Atrium is free and open source. Deploy it to Netlify in one click, or run it with Docker. Get it on GitHub.", run: async () => {
    await card.evaluate(() => document.body.classList.add("in"));
  } },
];

// ---------------------------------------------------------------------------------------------
// Record every beat, then lay the voice and captions over the joined clips.

const only = process.env.ONLY ? Number(process.env.ONLY) : null;
const clips = [];
for (const [i, b] of beats.entries()) {
  if (only !== null && i > only) break;
  const vo = voice(b.say ?? b.text, b.text);
  const want = LEAD + vo.seconds + TAIL;
  await b.setup?.();
  const pages = b.split ?? [b.page];
  await pages[0].bringToFront();
  const recs = await Promise.all(pages.map((p) => startRecording(p)));
  const started = Date.now();
  await b.run();
  const left = want - (Date.now() - started) / 1000;
  if (left > 0) await sleep(left * 1000);
  const out = path.join(BUILD, `beat${String(i).padStart(2, "0")}.mp4`);
  if (b.split) {
    const halves = pages.map((_, k) => out.replace(/\.mp4$/, `_${k}.mp4`));
    await Promise.all(recs.map((r, k) => r.stop(halves[k], { width: 960, height: 1080 })));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", halves[0], "-i", halves[1], "-filter_complex",
      // A thin dark seam between the two screens.
      "[0:v]crop=958:1080:0:0,pad=960:1080:0:0:color=0x0b0c10[l];[1:v]crop=958:1080:2:0,pad=960:1080:2:0:color=0x0b0c10[r];[l][r]hstack=inputs=2:shortest=1,format=yuv420p[v]",
      "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "16", out]);
  } else {
    await recs[0].stop(out);
  }
  clips.push({ out, vo, text: b.text, seconds: probe(out) });
  console.log(`beat ${i}: ${clips.at(-1).seconds.toFixed(1)}s (voice ${vo.seconds.toFixed(1)}s)`);
}
await browser.close();

const list = path.join(BUILD, "clips.txt");
fs.writeFileSync(list, clips.map((c) => `file '${c.out}'`).join("\n"));
const total = clips.reduce((s, c) => s + c.seconds, 0);
const args = ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list];
const graph = [];
let t = 0, srt = "", n = 0;
const ass = [
  "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  // Small white text on a soft dark box, sitting low and centred.
  "Style: Cap,Noto Sans,34,&H00FFFFFF,&H00FFFFFF,&H5A16131F,&H00000000,0,0,0,0,100,100,0.3,0,3,9,0,2,40,40,46,1",
  "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
];
const stamp = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace(".", ",");
const assStamp = (s) => { const d = new Date(s * 1000).toISOString(); return `${Number(d.slice(11, 13))}${d.slice(13, 22)}`; };
clips.forEach((c, i) => {
  args.push("-i", c.vo.file);
  graph.push(`[${i + 1}:a]aresample=48000,adelay=${Math.round((t + LEAD) * 1000)}:all=1[a${i}]`);
  for (const q of c.vo.cues) {
    // Only the last line of a beat lingers; inside a beat, one line hands straight to the next.
    const a = t + LEAD + q.start, b = t + LEAD + q.end + (q === c.vo.cues.at(-1) ? 0.25 : -0.02);
    srt += `${++n}\n${stamp(a)} --> ${stamp(b)}\n${q.line}\n\n`;
    ass.push(`Dialogue: 0,${assStamp(a)},${assStamp(b)},Cap,,0,0,0,,{\\fad(120,120)}${q.line}`);
  }
  t += c.seconds;
});
const assFile = path.join(BUILD, "captions.ass");
fs.writeFileSync(assFile, ass.join("\n") + "\n");

// Voice only, no music bed: a little warmth and gentle compression.
graph.push(`${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0,`
  + `highpass=f=70,equalizer=f=180:t=q:w=1:g=1.5,equalizer=f=6500:t=q:w=1.5:g=-2,`
  + `acompressor=threshold=-20dB:ratio=2.5:attack=8:release=180,aformat=channel_layouts=stereo,`
  + `loudnorm=I=-16:TP=-1.5,aresample=48000,apad,atrim=0:${total.toFixed(3)}[a]`);
graph.push(`[0:v]ass='${assFile.replace(/'/g, "\\'")}',fade=t=in:d=0.5,fade=t=out:st=${(total - 0.9).toFixed(3)}:d=0.9[v]`);
const out = path.join(only !== null ? BUILD : MEDIA, "atrium-demo.mp4");
execFileSync("ffmpeg", [...args, "-filter_complex", graph.join(";"), "-map", "[v]", "-map", "[a]",
  "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out]);
// Kept out of docs/media: players auto-load a same-named .srt on top of the burned-in captions.
fs.writeFileSync(path.join(BUILD, "atrium-demo.srt"), srt);
console.log(`done: ${out} (${total.toFixed(1)}s)`);
