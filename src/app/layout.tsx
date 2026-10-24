import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-face", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Atrium — open-source office suite", template: "%s · Atrium" },
  description:
    "Docs, Sheets, Slides, Drive and Notebook in one free, open-source app. Opens and saves Word, Excel and PowerPoint files. AGPL-3.0 licensed.",
};

// Applies the saved theme before first paint so there is no flash of the wrong theme.
const themeScript = `try{var t=localStorage.getItem("atrium-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
