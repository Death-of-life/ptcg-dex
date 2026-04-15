import { notFound } from "next/navigation";
import LangHomeClient from "./LangHomeClient";
import { type Lang } from "../lib/types";

const SUPPORTED_LANGS: ReadonlySet<Lang> = new Set(["zh-tw", "ja", "en"]);

export function generateStaticParams() {
  return [{ lang: "zh-tw" }, { lang: "ja" }, { lang: "en" }];
}

export default async function LangPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!SUPPORTED_LANGS.has(lang as Lang)) {
    notFound();
  }

  return <LangHomeClient lang={lang as Lang} />;
}
