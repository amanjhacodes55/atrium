// Captures the README screenshots from a running app (BASE, default http://localhost:3013).
//   node docs/video/screenshots.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, guest, launch, sleep } from "./rec.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../screenshots");
const VIEW = { width: 1440, height: 900 };
const browser = await launch();

async function context(name) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: "light" });
  // The name other people see next to your cursor, as if you had typed it on a shared link.
  if (name) await ctx.addInitScript((n) => localStorage.setItem("atrium-live-name", n), name);
  return ctx;
}

const owner = await (await context("Priya Shah")).newPage();
await guest(owner);
const { items } = await (await owner.request.get(`${BASE}/api/items`)).json();
const find = (name) => items.find((i) => i.name === name);
const shot = async (page, name) => {
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};

await sleep(800);
await shot(owner, "home");

await owner.goto(`${BASE}/drive?folder=${find("Projects").id}`);
await shot(owner, "drive");

await owner.goto(`${BASE}/sheets/${find("Budget 2026").id}`);
await owner.waitForSelector("table, [role=grid]");
await shot(owner, "sheets");

await owner.goto(`${BASE}/slides/${find("Atrium Pitch Deck").id}`);
await sleep(800);
await shot(owner, "slides");

await owner.goto(`${BASE}/notebook/${find("Team Notebook").id}`);
await sleep(800);
await shot(owner, "notebook");

// Two people in the handbook: Priya owns it, Sam joins through an edit link.
const handbook = find("Team Handbook");
const share = await (await owner.request.post(`${BASE}/api/items/${handbook.id}/share`, { data: { on: true, role: "edit" } })).json();
await owner.goto(`${BASE}/docs/${handbook.id}`);
await owner.waitForSelector(".ProseMirror");
const sam = await (await context("Sam Rivera")).newPage();
await sam.goto(`${BASE}/s/${share.item.shareId}`);
await sam.waitForSelector(".ProseMirror");
await sleep(1500);
const para = sam.locator(".ProseMirror p").nth(2);
const box = await para.boundingBox();
// The end of the paragraph's last line.
await sam.mouse.click(box.x + box.width - 2, box.y + box.height - 6);
await sam.keyboard.press("End");
await sam.keyboard.type(" Every team writes its own page here.", { delay: 15 });
await owner.locator(".ProseMirror h2").first().click();
await owner.keyboard.press("End");
await sleep(2500);
await shot(owner, "docs");

// The page boundary between pages one and two.
await owner.evaluate(() => {
  const s = document.querySelectorAll(".page-sheet")[1];
  s.closest(".overflow-auto").scrollTop = s.offsetTop - 430;
});
await shot(owner, "pages");
await shot(sam, "shared-link");

// Dark mode, on the home page.
await owner.evaluate(() => localStorage.setItem("atrium-theme", "dark"));
await owner.goto(`${BASE}/drive`);
await owner.evaluate(() => (document.documentElement.dataset.theme = "dark"));
await shot(owner, "dark");
await browser.close();
console.log("screenshots written to", OUT);
