import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "@/lib/api/response";
import { blogPosts } from "@/lib/blog/posts";
import { PUBLIC_PAGES, absoluteUrl } from "@/lib/seo/public-pages";
// Stamped by the pre-commit hook (scripts/bump-lastmod.ts) when a page's
// content is committed; edit by hand only to backdate.
import STATIC_PAGE_LASTMOD from "@/lib/seo/static-page-lastmod.json";

const staticPageLastmod: Readonly<Record<string, string>> = STATIC_PAGE_LASTMOD;

function lastmod(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function postLastmodIso(post: { publishedAt: string; dateModified?: string }): string {
  const modified = post.dateModified ?? post.publishedAt;

  return modified > post.publishedAt ? modified : post.publishedAt;
}

function sitemap() {
  const latestPostDate = blogPosts.reduce((latest, post) => {
    const modified = postLastmodIso(post);

    return modified > latest ? modified : latest;
  }, "2025-01-01");

  const pageEntries = PUBLIC_PAGES.map((page) => ({
    url: absoluteUrl(page.path),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
    lastModified: lastmod(page.path === "/blog" ? latestPostDate : staticPageLastmod[page.path]),
  }));

  const blogEntries = blogPosts.map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    changeFrequency: "monthly",
    priority: post.slug === "asu-class-seat-tracker" ? 0.9 : 0.7,
    lastModified: lastmod(postLastmodIso(post)),
  }));

  const entries = [...pageEntries, ...blogEntries].map(
    (entry) => `<url>
<loc>${entry.url}</loc>
<lastmod>${entry.lastModified.toISOString()}</lastmod>
<changefreq>${entry.changeFrequency}</changefreq>
<priority>${entry.priority}</priority>
</url>`,
  );

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`,
    {
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    },
  );
}

export const Route = createFileRoute("/sitemap.xml")({
  server: { handlers: { GET: sitemap, ANY: methodNotAllowed } },
});
