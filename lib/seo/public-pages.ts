import type { MetadataRoute } from "next";

export const SITE_ORIGIN = "https://pickmyclass.app";

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

export interface PublicPage {
  path: string;
  /** Link text in the agent files (`/llms-full.txt`). */
  label: string;
  changeFrequency: ChangeFrequency;
  priority: number;
}

/**
 * Indexable non-blog pages, in sitemap order. The sitemap and the agent files
 * both read this list; blog posts come from `lib/blog/posts.ts`. Every path
 * except `/blog` needs a date in `static-page-lastmod.json`.
 */
export const PUBLIC_PAGES: readonly PublicPage[] = [
  { path: "/", label: "Home", changeFrequency: "weekly", priority: 1.0 },
  { path: "/faq", label: "FAQ", changeFrequency: "monthly", priority: 0.8 },
  { path: "/blog", label: "Blog index", changeFrequency: "weekly", priority: 0.6 },
  { path: "/about", label: "About", changeFrequency: "monthly", priority: 0.5 },
  { path: "/contact", label: "Contact and support", changeFrequency: "yearly", priority: 0.4 },
  {
    path: "/docs",
    label: "Developer & agent resources",
    changeFrequency: "monthly",
    priority: 0.4,
  },
  { path: "/legal/terms", label: "Terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/privacy", label: "Privacy", changeFrequency: "yearly", priority: 0.3 },
];

export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path}`;
}
