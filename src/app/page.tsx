import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, Cloud, Download, FileStack, Lock, Share2, Smartphone, Sparkles, Users } from "lucide-react";
import { APPS, AppTile, GithubMark, Logo } from "@/components/app-icon";
import { GuestButton } from "@/components/auth-form";
import { COOKIE } from "@/lib/auth-cookie";

const REPO = "https://github.com/amanjhacodes55/atrium";
/** The Android app, published as a GitHub release (see android/README.md). */
const APK = `${REPO}/releases/download/android-v1.0.0/atrium-android-v1.0.0.apk`;

const DETAILS: Record<string, string[]> = {
  doc: ["Write together live, with everyone's cursor on the page", "Real A4 and Letter pages, split line by line like Word", "Open and save Word (.docx), export PDF, HTML, Markdown"],
  sheet: ["400+ Excel-compatible formulas, cross-sheet references", "Open and save Excel (.xlsx) and CSV", "Formats, colours, sorting, frozen rows, multiple tabs"],
  slides: ["Text, shapes, images, themes, speaker notes", "Save as PowerPoint (.pptx) or PDF", "Full-screen presenter with keyboard control"],
  drive: ["Folders, drag-and-drop uploads, previews", "Star, search, move, trash and restore", "Public links for any file, and a Shared with me list"],
  notebook: ["Notebooks with coloured sections and pages", "Checklists, rich text and images on every page", "Search across pages, autosaves as you type"],
  pdf: ["Merge, split, create and edit PDFs: text, images, signatures", "OCR scans into searchable PDFs, in 18 languages", "PDF to Word and Word to PDF, all on your device"],
};

const FEATURES = [
  { Icon: FileStack, title: "Works with Office files", text: "Open .docx, .xlsx, .csv and .pptx files, edit them, and download them back in the same format." },
  { Icon: Cloud, title: "Autosave everywhere", text: "Every keystroke is saved within a second. Close the tab whenever you like." },
  { Icon: Users, title: "Edit together, live", text: "Share a document with an edit link and write in it together, like Google Docs: live cursors, names and edits, no account needed." },
  { Icon: Share2, title: "Share with a link", text: "A public link for any document, sheet, deck, notebook or file, as viewer or editor. Turn it off any time." },
  { Icon: Lock, title: "Your server, your data", text: "Self-host it with Docker or one click on Netlify. No tracking, no ads, no third parties." },
  { Icon: Sparkles, title: "Free and open source", text: "AGPL-3.0 licensed. Use it, change it, run it for your team. Improvements stay open for everyone." },
];

export default async function Landing() {
  const signedIn = Boolean((await cookies()).get(COOKIE)?.value);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Logo size={30} />
          <span className="text-lg font-semibold">Atrium</span>
          <nav className="ml-6 hidden gap-5 text-sm text-ink-2 sm:flex">
            <a href="#apps" className="hover:text-ink">
              Apps
            </a>
            <a href="#features" className="hover:text-ink">
              Features
            </a>
            <a href="#android" className="hover:text-ink">
              Android app
            </a>
            <a href={REPO} className="hover:text-ink">
              GitHub
            </a>
          </nav>
          <div className="flex-1" />
          {signedIn ? (
            <Link href="/home" className="btn btn-primary">
              Open Atrium <ArrowRight size={16} />
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost">
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-primary">
                Sign up free
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(37,99,235,0.14),transparent)]" />
        <div className="mx-auto max-w-4xl px-4 pb-10 pt-20 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2">
            <Sparkles size={13} className="text-accent" /> 100% free and open source
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
            Your whole office,
            <br />
            <span className="bg-gradient-to-r from-blue-600 via-violet-600 to-orange-500 bg-clip-text text-transparent">in one open app.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-2">
            Atrium gives you Docs, Sheets, Slides, Drive and Notebook in a single workspace, like Microsoft 365 or Zoho Workplace, without the subscription.
          </p>
          <div className="mx-auto mt-9 flex max-w-md flex-col justify-center gap-3 sm:flex-row">
            {signedIn ? (
              <Link href="/home" className="btn btn-primary h-12 px-6 text-base">
                Open your workspace <ArrowRight size={18} />
              </Link>
            ) : (
              <>
                <GuestButton className="btn btn-primary h-12 px-6 text-base" />
                <Link href="/signup" className="btn h-12 px-6 text-base">
                  Create a free account
                </Link>
              </>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">No sign-up needed to try it: you get a workspace with sample files.</p>
        </div>
      </section>

      <section id="apps" className="mx-auto w-full max-w-6xl px-4 py-14">
        <h2 className="text-center text-2xl font-semibold sm:text-3xl">Six apps. One login. One drive.</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {APPS.map((a) => (
            <div key={a.kind} className="card p-5">
              <AppTile kind={a.kind} size={44} />
              <h3 className="mt-4 text-lg font-semibold">{a.name}</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
                {DETAILS[a.kind].map((d) => (
                  <li key={d} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ background: a.color }} />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <f.Icon size={22} className="text-accent" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-ink-2">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="android" className="mx-auto w-full max-w-6xl px-4 pt-16">
        <div className="card flex flex-col items-center gap-6 p-8 text-center md:flex-row md:text-left">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-accent/10 text-accent">
            <Smartphone size={30} />
          </span>
          <div className="flex-1">
            <h2 className="text-2xl font-semibold">Atrium for Android</h2>
            <p className="mt-2 text-ink-2">
              Your Drive in your pocket: browse, create, upload and share files, and open Atrium links straight in the app. It uses the same account as the website.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1.5">
            <a href={APK} className="btn btn-primary h-12 px-6 text-base" id="download-android">
              <Download size={18} /> Download for Android
            </a>
            <span className="text-xs text-muted">APK · Android 8.0 or newer · 12 MB</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h2 className="text-2xl font-semibold sm:text-3xl">Built in the open, free for the world</h2>
        <p className="mt-4 text-ink-2">
          Atrium is licensed under the GNU AGPL-3.0. Anyone can use, study, change and share it, and anyone who runs a changed version as a service has to share their changes too.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <a href={REPO} className="btn h-11 px-5">
            <GithubMark size={17} /> Star on GitHub
          </a>
          <Link href={signedIn ? "/home" : "/signup"} className="btn btn-primary h-11 px-5">
            Get started <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      <footer className="mt-auto border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-6 text-sm text-muted">
          <Logo size={20} /> Atrium · AGPL-3.0-or-later
          <div className="flex-1" />
          <a href={REPO} className="hover:text-ink">
            Source code
          </a>
          <a href={APK} className="hover:text-ink">
            Android app
          </a>
          <a href={`${REPO}/blob/main/docs/api.md`} className="hover:text-ink">
            API docs
          </a>
          <a href={`${REPO}/blob/main/docs/self-hosting.md`} className="hover:text-ink">
            Self-hosting
          </a>
        </div>
      </footer>
    </div>
  );
}
