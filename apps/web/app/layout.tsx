import type { Metadata } from "next";
import { Noto_Sans_JP, Noto_Serif_JP } from "next/font/google";
import "./globals.css";

const sans = Noto_Sans_JP({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700"]
});

const serif = Noto_Serif_JP({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "700"]
});

export const metadata: Metadata = {
  title: "TCGdex Atlas",
  description: "Cloudflare 全栈 Pokemon 卡牌图鉴（英/日/繁中）"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={`${sans.variable} ${serif.variable}`}>{children}</body>
    </html>
  );
}
