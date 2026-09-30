import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { GET as getLlmsFull } from "@/app/llms-full.txt/route";
import { GET as getLlms } from "@/app/llms.txt/route";
import { blogPosts } from "@/lib/blog/posts";
import { FEATURED_GUIDE_SLUGS, buildLlmsTxt } from "@/lib/seo/llms";
import { CURATED_GUIDE_SLUGS, buildLlmsFullTxt } from "@/lib/seo/llms-full";
import { PUBLIC_PAGES, SITE_ORIGIN, absoluteUrl } from "@/lib/seo/public-pages";
import { markdownSourcePath } from "@/lib/worker/markdown-negotiation";

const root = process.cwd();

/** `app/sign-up` holds `[[...sign-up]]/page.tsx`, which also serves `/sign-up`. */
function hasOptionalCatchAllPage(appDir: string): boolean {
  if (!existsSync(appDir)) return false;

  return readdirSync(appDir).some(
    (entry) => entry.startsWith("[[...") && existsSync(join(appDir, entry, "page.tsx")),
  );
}

/** True when `path` is served: a page, blog post, route handler, or public file. */
function isServedPath(path: string): boolean {
  const pagePath = markdownSourcePath(path) ?? path;
  const appDir = join(root, "app", pagePath);

  return (
    PUBLIC_PAGES.some((page) => page.path === pagePath) ||
    blogPosts.some((post) => `/blog/${post.slug}` === pagePath) ||
    existsSync(join(appDir, "page.tsx")) ||
    existsSync(join(appDir, "route.ts")) ||
    hasOptionalCatchAllPage(appDir) ||
    // Metadata routes: app/sitemap.ts serves /sitemap.xml, app/robots.ts /robots.txt.
    existsSync(join(root, "app", path.replace(/\.(?:xml|txt)$/, ".ts"))) ||
    existsSync(join(root, "public", path))
  );
}

function sitePaths(text: string): string[] {
  const urls = text.match(/https:\/\/pickmyclass\.app[^\s)`]*/g) ?? [];

  return urls.map((url) => new URL(url.replace(/[.,]$/, "")).pathname);
}

describe("production SEO and AI discovery assets", () => {
  it("generates llms.txt with high-intent ASU class tracking answers", () => {
    const llms = buildLlmsTxt();

    for (const text of [
      "# PickMyClass",
      "ASU class seat tracker",
      "pickmyclass",
      "pick my class",
      "ASU class tracker",
      "ASU class finder",
      "ASU class registration",
      "My ASU",
      "https://pickmyclass.app/",
      "https://pickmyclass.app/faq",
      "https://pickmyclass.app/blog/asu-class-seat-tracker",
      "`/index.md`, `/faq.md`",
    ]) {
      expect(llms).toContain(text);
    }

    expect(llms).not.toContain("undefined");
    expect(llms).not.toContain("null");
  });

  it("features only published guides in llms.txt, each once", () => {
    const slugs = new Set(blogPosts.map((post) => post.slug));

    for (const slug of FEATURED_GUIDE_SLUGS) {
      expect(slugs.has(slug)).toBe(true);
      expect(buildLlmsTxt()).toContain(absoluteUrl(`/blog/${slug}`));
    }

    expect(new Set(FEATURED_GUIDE_SLUGS).size).toBe(FEATURED_GUIDE_SLUGS.length);
  });

  it.each([
    ["llms.txt", buildLlmsTxt],
    ["llms-full.txt", buildLlmsFullTxt],
    ["pricing.md", () => readFileSync(join(root, "public", "pricing.md"), "utf8")],
  ])("links only to served paths from %s", (_name, build) => {
    const paths = sitePaths(build());

    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) expect(isServedPath(path), `${SITE_ORIGIN}${path}`).toBe(true);
  });

  it.each([
    ["/llms.txt", getLlms, buildLlmsTxt],
    ["/llms-full.txt", getLlmsFull, buildLlmsFullTxt],
  ])("serves %s as cacheable UTF-8 plain text", async (path, get, build) => {
    const response = get();

    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(await response.text()).toBe(build());
    expect(existsSync(join(root, "public", path)), `public${path} would shadow the route`).toBe(
      false,
    );
  });

  it("generates llms-full.txt with every public guide and public crawl target", () => {
    const full = buildLlmsFullTxt();

    expect(full.startsWith("# PickMyClass Full AI Search Reference\n")).toBe(true);
    expect(full).not.toContain("undefined");

    for (const post of blogPosts) {
      expect(full).toContain(`URL: https://pickmyclass.app/blog/${post.slug}`);
      expect(full).toContain(`### ${post.title}`);
    }

    for (const page of PUBLIC_PAGES) {
      expect(full).toContain(`- ${page.label}: ${absoluteUrl(page.path)}\n`);
    }
  });

  it("only curates llms-full.txt summaries for published posts, each once", () => {
    const slugs = new Set(blogPosts.map((post) => post.slug));

    for (const slug of CURATED_GUIDE_SLUGS) expect(slugs.has(slug)).toBe(true);

    expect(new Set(CURATED_GUIDE_SLUGS).size).toBe(CURATED_GUIDE_SLUGS.length);
  });

  it("falls back hero ATF copy to opacity 1 without JS and for reduced motion", () => {
    const css = readFileSync(join(root, "app/globals.css"), "utf8");

    expect(css).toContain(".animation-hidden");
    expect(css).toContain("hero-atf-appear");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("scripting: none");
    expect(css).toMatch(/\.animation-hidden[\s\S]*opacity:\s*1\s*!important/);
  });
});
