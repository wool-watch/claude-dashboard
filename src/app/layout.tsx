import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { SettingsMenu } from "@/components/SettingsMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

/** FOUC防止: ハイドレーション前に localStorage / OS 設定から .dark を即時適用する */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Claude Code ダッシュボード",
  description: "Claude Code のローカル使用状況ダッシュボード",
};

const NAV_ITEMS = [
  { href: "/", label: "ダッシュボード" },
  { href: "/projects", label: "プロジェクト" },
  { href: "/sessions", label: "セッション" },
] as const;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint: テーマ初期化はハイドレーション前に実行する必要がある */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-black/10 dark:border-white/15">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <span className="font-semibold">Claude Code ダッシュボード</span>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            <span className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <SettingsMenu />
            </span>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
