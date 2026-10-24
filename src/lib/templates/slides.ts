import type { Slide, SlideEl, SlidesBody } from "../types";
import type { Template } from "./index";

// Built-in presentation templates. Element ids only need to be unique within a slide.

type Palette = { bg: string; title: string; text: string; accent: string; soft: string };

const t = (id: string, x: number, y: number, w: number, h: number, text: string, size: number, color: string, extra: Partial<SlideEl> = {}): SlideEl => ({
  id,
  type: "text",
  x,
  y,
  w,
  h,
  text,
  size,
  color,
  ...extra,
});
const shape = (id: string, type: "rect" | "ellipse", x: number, y: number, w: number, h: number, fill: string): SlideEl => ({ id, type, x, y, w, h, fill });

function deck(theme: string, p: Palette, slides: ((p: Palette) => Omit<Slide, "id">)[]): SlidesBody {
  return { type: "slides", theme, slides: slides.map((make, i) => ({ id: `t${i + 1}`, ...make(p) })) };
}

const titleSlide = (title: string, subtitle: string, notes = "") => (p: Palette) => ({
  bg: p.bg,
  notes,
  els: [
    shape("bar", "rect", 80, 150, 12, 220, p.accent),
    t("title", 120, 150, 760, 130, title, 60, p.title, { bold: true }),
    t("sub", 120, 290, 760, 80, subtitle, 26, p.text),
  ],
});

const bullets = (title: string, items: string[], notes = "") => (p: Palette) => ({
  bg: p.bg,
  notes,
  els: [
    t("title", 60, 40, 840, 70, title, 40, p.title, { bold: true }),
    shape("rule", "rect", 64, 112, 80, 6, p.accent),
    t("body", 60, 150, 840, 340, items.map((i) => `•  ${i}`).join("\n"), 26, p.text),
  ],
});

const threeCards = (title: string, cards: [string, string][], notes = "") => (p: Palette) => ({
  bg: p.bg,
  notes,
  els: [
    t("title", 60, 40, 840, 70, title, 40, p.title, { bold: true }),
    ...cards.flatMap(([head, body], i) => [
      shape(`c${i}`, "rect", 60 + i * 290, 150, 260, 300, p.soft),
      shape(`d${i}`, "ellipse", 85 + i * 290, 175, 56, 56, p.accent),
      t(`n${i}`, 85 + i * 290, 185, 56, 40, String(i + 1), 24, "#ffffff", { bold: true, align: "center" }),
      t(`h${i}`, 80 + i * 290, 250, 220, 50, head, 26, p.title, { bold: true }),
      t(`b${i}`, 80 + i * 290, 300, 220, 140, body, 18, p.text),
    ]),
  ],
});

const big = (stat: string, caption: string, notes = "") => (p: Palette) => ({
  bg: p.accent,
  notes,
  els: [t("stat", 60, 140, 840, 160, stat, 120, "#ffffff", { bold: true, align: "center" }), t("cap", 120, 320, 720, 80, caption, 28, "#ffffff", { align: "center" })],
});

const closing = (title: string, sub: string) => (p: Palette) => ({
  bg: p.bg,
  notes: "",
  els: [t("title", 80, 190, 800, 100, title, 56, p.title, { bold: true, align: "center" }), t("sub", 80, 300, 800, 60, sub, 24, p.accent, { align: "center" })],
});

const OCEAN: Palette = { bg: "#0f172a", title: "#f8fafc", text: "#cbd5e1", accent: "#38bdf8", soft: "#1e293b" };
const PAPER: Palette = { bg: "#ffffff", title: "#111827", text: "#374151", accent: "#ea580c", soft: "#fff7ed" };
const LAVENDER: Palette = { bg: "#f5f3ff", title: "#4c1d95", text: "#3b0764", accent: "#7c3aed", soft: "#ede9fe" };

export const templates: Template[] = [
  {
    name: "Pitch deck",
    description: "Problem, solution, traction and the ask",
    body: deck("dark", OCEAN, [
      titleSlide("Northwind", "Coffee subscriptions that roast to order", "Introduce yourself and the one-line pitch."),
      bullets("The problem", ["Supermarket coffee is roasted months before it is drunk", "Specialty roasters cannot reach customers directly", "Subscriptions today are rigid and hard to pause"]),
      threeCards("How it works", [
        ["Pick", "Tell us how you brew and what you like."],
        ["Roast", "Partner roasters roast your beans the day they ship."],
        ["Enjoy", "Fresh coffee at your door, pause any time."],
      ]),
      big("12,400", "paying subscribers after 9 months, growing 18% a month"),
      closing("Raising $1.5M", "hello@northwind.example"),
    ]),
  },
  {
    name: "Project update",
    description: "Status, milestones, risks and next steps",
    body: deck("light", PAPER, [
      titleSlide("Website relaunch", "Status update · Week 6", "Keep this under ten minutes."),
      threeCards("Where we are", [
        ["Done", "Design system, home page and pricing page are live in staging."],
        ["In progress", "Docs migration and the new sign-up flow."],
        ["Next", "Load testing and the launch announcement."],
      ]),
      bullets("Risks", ["Docs migration may slip a week: 40% of pages still need review", "Analytics needs consent banner sign-off from legal", "Launch date depends on load test results"]),
      bullets("Decisions needed", ["Approve the launch date of 14 November", "Agree who owns the docs after launch"]),
    ]),
  },
  {
    name: "Lesson",
    description: "Learning goals, key ideas and a quick quiz",
    body: deck("lavender", LAVENDER, [
      titleSlide("The water cycle", "Science · Year 6"),
      bullets("By the end of this lesson you can", ["Name the four stages of the water cycle", "Explain what drives evaporation", "Give an example of each stage from everyday life"]),
      threeCards("Key ideas", [
        ["Evaporation", "The sun warms water and it rises as vapour."],
        ["Condensation", "Vapour cools and forms clouds."],
        ["Precipitation", "Water falls back as rain, snow or hail."],
      ]),
      bullets("Quick quiz", ["Why do puddles disappear on a sunny day?", "Where does the water on a cold glass come from?", "What happens to rain after it lands?"]),
    ]),
  },
];
