import { createItem, uploadFile } from "./drive";
import type { Body, SheetTab, Slide } from "./types";

// Sample files for a guest workspace, so every app has something real to open on first visit.

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };

const text = (t: string, ...marks: string[]): Node => ({ type: "text", text: t, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const p = (...content: (Node | string)[]): Node => ({ type: "paragraph", content: content.map((c) => (typeof c === "string" ? text(c) : c)) });
const h = (level: number, t: string): Node => ({ type: "heading", attrs: { level }, content: [text(t)] });
const ul = (...items: string[]): Node => ({ type: "bulletList", content: items.map((i) => ({ type: "listItem", content: [p(i)] })) });
const tasks = (...items: [string, boolean][]): Node => ({
  type: "taskList",
  content: items.map(([t, checked]) => ({ type: "taskItem", attrs: { checked }, content: [p(t)] })),
});
const cell = (t: string, header = false): Node => ({ type: header ? "tableHeader" : "tableCell", content: [p(t)] });
const table = (rows: string[][]): Node => ({
  type: "table",
  content: rows.map((r, i) => ({ type: "tableRow", content: r.map((c) => cell(c, i === 0)) })),
});
const doc = (...content: Node[]) => ({ type: "doc", content });

const launchPlan = doc(
  h(1, "Q4 Product Launch Plan"),
  p(text("Owner: ", "bold"), "Product team · ", text("Status: ", "bold"), "In review"),
  h(2, "Goals"),
  ul("Ship Atrium 2.0 to every customer by 15 December", "Reach 10,000 weekly active teams", "Keep support response under 4 hours during launch week"),
  h(2, "Timeline"),
  table([
    ["Milestone", "Date", "Owner"],
    ["Feature freeze", "3 Nov", "Engineering"],
    ["Beta with 50 teams", "17 Nov", "Product"],
    ["Launch event", "1 Dec", "Marketing"],
    ["General availability", "15 Dec", "Everyone"],
  ]),
  h(2, "Risks"),
  p("The biggest risk is ", text("migration of existing files", "italic"), ". We will run a dry run on a copy of production data two weeks before launch."),
  { type: "blockquote", content: [p("Ship small, ship often, and tell people what changed.")] },
);

// Long enough to run over several pages, so the page layout shows on first open.
const handbook = doc(
  h(1, "Team Handbook"),
  p(text("How we work, ", "italic"), text("written down so nobody has to guess.", "italic"), " Edit it together: share it with an edit link and everyone's changes appear as they type."),
  h(2, "1. Who we are"),
  p("We are a small team building tools that people use every day. We care about software that is fast, calm and honest about what it does. We would rather ship one thing that works well than five that almost work."),
  p("Most of us work remotely across three time zones. That shapes almost everything below: we write things down, we make decisions in the open, and we try hard not to make anyone wait on a meeting to get unblocked."),
  h(2, "2. How we communicate"),
  p("Default to writing. A short written proposal beats a long call, because people can read it when they are at their best and reply with thought instead of reflex. When a call is the right tool, someone takes notes in a shared document and links it in the team channel afterwards."),
  ul(
    "Urgent and blocking: message the person directly, and say that it is urgent.",
    "Needs a decision: write a one-page proposal and share it with an edit link.",
    "Status and progress: a weekly update in the team notebook, every Friday.",
    "Everything else: the team channel, where anyone can find it later.",
  ),
  p("Reply within a working day. If you need more time, say so and say when. Silence is the only wrong answer."),
  h(2, "3. Working hours"),
  p("We have four core hours, 14:00 to 18:00 UTC, when everyone is around for questions and pairing. Outside those hours, work when you do your best work. Nobody is expected to answer messages in the evening or at weekends, and nobody should send a message that needs one."),
  p("Put holidays in the team calendar at least two weeks ahead when you can. Take all of your holiday: we track that you do, not that you don't."),
  h(2, "4. Making decisions"),
  p("Most decisions are reversible, so make them quickly and write down why. For the few that are hard to undo (pricing, data formats, anything that touches customer files), write a proposal with the options you considered and leave it open for comments for two working days."),
  table([
    ["Kind of decision", "Who decides", "How long to wait"],
    ["Day-to-day work", "Whoever is doing it", "No wait"],
    ["Changes other teams depend on", "The owning team", "One working day"],
    ["Hard to undo", "The whole team", "Two working days"],
  ]),
  p("Disagree openly, then commit. Once a decision is made, we all help it succeed, and we revisit it with new evidence rather than old arguments."),
  h(2, "5. Shipping"),
  p("Small changes, shipped often, reviewed by one other person. Every change should leave the code a little clearer than it was. If you find yourself writing a long explanation in a review, that explanation probably belongs in the code or the docs."),
  ul(
    "Write the test that fails before the fix that passes.",
    "Keep pull requests small enough to review in fifteen minutes.",
    "Ship behind a setting when the change is large or risky.",
    "Tell people what changed, in plain words, in the release notes.",
  ),
  { type: "blockquote", content: [p("The best time to fix a confusing name is the moment you notice it.")] },
  h(2, "6. Onboarding checklist"),
  tasks(
    ["Get accounts for email, chat and the code host", true],
    ["Read this handbook and leave at least one comment", true],
    ["Pair with a teammate on a small change in your first week", false],
    ["Ship something to customers in your first two weeks", false],
    ["Write down one thing that confused you, and fix the docs", false],
  ),
  h(2, "7. Looking after each other"),
  p("Be kind, be direct, and assume good intent. Feedback is a gift when it is specific, timely and private. Praise is a gift when it is specific and public."),
  p("If something is wrong, say so early. If you are struggling, tell your lead or anyone you trust. We would always rather know."),
);

const budget: SheetTab = {
  name: "Budget",
  cells: {
    A1: "Category", B1: "Q1", C1: "Q2", D1: "Q3", E1: "Q4", F1: "Total", G1: "Share",
    A2: "Salaries", B2: "42000", C2: "43500", D2: "45000", E2: "47000",
    A3: "Cloud hosting", B3: "3200", C3: "3600", D3: "4100", E3: "4800",
    A4: "Marketing", B4: "8000", C4: "6500", D4: "9000", E4: "15000",
    A5: "Office & tools", B5: "2100", C5: "2100", D5: "2300", E5: "2400",
    A6: "Travel", B6: "1500", C6: "900", D6: "2600", E6: "3100",
    A8: "Total", A9: "Average",
  },
  styles: {},
  colWidths: { 0: 150, 6: 90 },
  frozen: { rows: 1, cols: 0 },
};
for (const r of [2, 3, 4, 5, 6]) {
  budget.cells[`F${r}`] = `=SUM(B${r}:E${r})`;
  budget.cells[`G${r}`] = `=F${r}/$F$8`;
  budget.styles[`G${r}`] = { fmt: "percent" };
}
for (const c of ["B", "C", "D", "E", "F"]) {
  budget.cells[`${c}8`] = `=SUM(${c}2:${c}6)`;
  budget.cells[`${c}9`] = `=ROUND(AVERAGE(${c}2:${c}6),0)`;
  for (let r = 2; r <= 9; r++) budget.styles[`${c}${r}`] = { fmt: "currency" };
}
for (const k of ["A1", "B1", "C1", "D1", "E1", "F1", "G1"]) budget.styles[k] = { b: true, bg: "#e8f5e9", align: k === "A1" ? "left" : "right" };
budget.styles.A8 = { b: true };
budget.styles.F8 = { b: true, fmt: "currency" };

const sales: SheetTab = {
  name: "Sales",
  cells: { A1: "Region", B1: "Units", C1: "Price", D1: "Revenue", A2: "North", B2: "120", C2: "49", A3: "South", B3: "95", C3: "49", A4: "East", B4: "143", C4: "45", A5: "West", B5: "88", C5: "52", A7: "Best region", B7: '=INDEX(A2:A5,MATCH(MAX(D2:D5),D2:D5,0))' },
  styles: { A1: { b: true }, B1: { b: true }, C1: { b: true }, D1: { b: true } },
  colWidths: {},
};
for (const r of [2, 3, 4, 5]) {
  sales.cells[`D${r}`] = `=B${r}*C${r}`;
  sales.styles[`D${r}`] = { fmt: "currency" };
}

const pitchSlides: Slide[] = [
  {
    id: "s1",
    bg: "#1e3a8a",
    notes: "Welcome everyone. Today: why teams are moving their office work to Atrium.",
    els: [
      { id: "t1", type: "text", x: 80, y: 180, w: 800, h: 100, text: "Atrium", size: 72, bold: true, align: "center", color: "#ffffff" },
      { id: "t2", type: "text", x: 80, y: 290, w: 800, h: 60, text: "Your whole office, in one open-source app", size: 28, align: "center", color: "#bfdbfe" },
    ],
  },
  {
    id: "s2",
    bg: "#ffffff",
    notes: "Five apps, one login, one drive.",
    els: [
      { id: "t1", type: "text", x: 60, y: 40, w: 840, h: 70, text: "Everything a team needs", size: 40, bold: true, color: "#1e3a8a" },
      { id: "r1", type: "rect", x: 60, y: 150, w: 160, h: 160, fill: "#2563eb" },
      { id: "r2", type: "rect", x: 240, y: 150, w: 160, h: 160, fill: "#16a34a" },
      { id: "r3", type: "rect", x: 420, y: 150, w: 160, h: 160, fill: "#ea580c" },
      { id: "r4", type: "rect", x: 600, y: 150, w: 160, h: 160, fill: "#ca8a04" },
      { id: "r5", type: "rect", x: 780, y: 150, w: 120, h: 160, fill: "#7c3aed" },
      { id: "l1", type: "text", x: 60, y: 210, w: 160, h: 40, text: "Docs", size: 24, bold: true, align: "center", color: "#ffffff" },
      { id: "l2", type: "text", x: 240, y: 210, w: 160, h: 40, text: "Sheets", size: 24, bold: true, align: "center", color: "#ffffff" },
      { id: "l3", type: "text", x: 420, y: 210, w: 160, h: 40, text: "Slides", size: 24, bold: true, align: "center", color: "#ffffff" },
      { id: "l4", type: "text", x: 600, y: 210, w: 160, h: 40, text: "Drive", size: 24, bold: true, align: "center", color: "#ffffff" },
      { id: "l5", type: "text", x: 780, y: 210, w: 120, h: 40, text: "Notes", size: 24, bold: true, align: "center", color: "#ffffff" },
      { id: "t2", type: "text", x: 60, y: 360, w: 840, h: 120, text: "Open and save Word, Excel and PowerPoint files.\nShare a read-only link with anyone.", size: 24, color: "#374151" },
    ],
  },
  {
    id: "s3",
    bg: "#f8fafc",
    notes: "Self-hosting is one command, and the hosted version is free.",
    els: [
      { id: "t1", type: "text", x: 60, y: 40, w: 840, h: 70, text: "Free and open source", size: 40, bold: true, color: "#1e3a8a" },
      { id: "e1", type: "ellipse", x: 80, y: 160, w: 220, h: 220, fill: "#dbeafe" },
      { id: "n1", type: "text", x: 80, y: 235, w: 220, h: 70, text: "AGPL-3.0", size: 32, bold: true, align: "center", color: "#1e3a8a" },
      { id: "t2", type: "text", x: 360, y: 160, w: 540, h: 240, text: "• No subscriptions, no seat limits\n• Your files stay on your server\n• Every change to the code stays open\n• Runs on Netlify, Docker or any Node host", size: 26, color: "#1f2937" },
    ],
  },
];

const notebook: Body = {
  type: "notebook",
  color: "#7c3aed",
  sections: [
    {
      id: "sec1",
      name: "Meetings",
      color: "#7c3aed",
      pages: [
        {
          id: "pg1",
          title: "Weekly sync, 20 Oct",
          updatedAt: Date.now() - 86_400_000,
          content: doc(
            h(2, "Weekly sync"),
            p(text("Attendees: ", "bold"), "Priya, Marcus, Lena, Tom"),
            h(3, "Decisions"),
            ul("Beta opens to 50 teams on 17 Nov", "Pricing page copy is final"),
            h(3, "Action items"),
            tasks(["Send beta invites", true], ["Record the onboarding video", false], ["Update the help centre", false]),
          ),
        },
        {
          id: "pg2",
          title: "Design review",
          updatedAt: Date.now() - 3 * 86_400_000,
          content: doc(h(2, "Design review"), p("New file icons are approved. The dark theme needs more contrast on the sidebar."), tasks(["Bump sidebar text contrast", false])),
        },
      ],
    },
    {
      id: "sec2",
      name: "Ideas",
      color: "#0891b2",
      pages: [
        {
          id: "pg3",
          title: "Feature wishlist",
          updatedAt: Date.now() - 5 * 86_400_000,
          content: doc(h(2, "Feature wishlist"), ul("Real-time co-editing", "Comments on any file", "Calendar and mail", "Offline mode")),
        },
      ],
    },
  ],
};

export async function seedSamples(userId: string) {
  const projects = await createItem(userId, { kind: "folder", name: "Projects" });
  const finance = await createItem(userId, { kind: "folder", name: "Finance" });
  await createItem(userId, { kind: "folder", name: "Marketing" });
  await createItem(userId, { kind: "doc", name: "Q4 Product Launch Plan", parentId: projects.id, body: { type: "doc", content: launchPlan, page: { size: "a4", margins: "normal" } } });
  await createItem(userId, { kind: "doc", name: "Team Handbook", body: { type: "doc", content: handbook, page: { size: "a4", margins: "normal" } } });
  await createItem(userId, { kind: "sheet", name: "Budget 2026", parentId: finance.id, body: { type: "sheet", sheets: [budget, sales] } });
  await createItem(userId, { kind: "slides", name: "Atrium Pitch Deck", parentId: projects.id, body: { type: "slides", theme: "light", slides: pitchSlides } });
  await createItem(userId, { kind: "notebook", name: "Team Notebook", body: notebook });
  await uploadFile(userId, {
    name: "Welcome.txt",
    mime: "text/plain",
    parentId: null,
    bytes: Buffer.from(
      "Welcome to Atrium!\n\nThis is a guest workspace with sample files. Everything here is yours to edit.\nSign up from the account menu to keep your files.\n",
    ),
  });
}
