import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeSync } from "@/components/ThemeSync";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/config";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — Fire monitoring command center`,
  description: PRODUCT_TAGLINE,
};

// Applies the saved theme before the first paint (Settings › Theme), so dark mode never flashes.
const THEME_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem("pehradar.preferences")||"{}");var t=p.theme;if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
