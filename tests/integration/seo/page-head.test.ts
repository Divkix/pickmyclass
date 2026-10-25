import { describe, expect, it } from "vite-plus/test";
import { blogPosts } from "@/lib/blog/posts";
import { NOT_FOUND_HEAD } from "@/lib/seo/head";
import { PUBLIC_PAGES, SITE_ORIGIN, absoluteUrl } from "@/lib/seo/public-pages";

const MAX_TITLE = 60;
const MAX_DESCRIPTION = 160;

interface HeadTags {
  meta?: Array<{ title?: string; name?: string; content?: string } | undefined>;
  links?: Array<{ rel?: string; href?: string } | undefined>;
}

interface RouteModule {
  Route?: { options: { head?: (context: { matches: [] }) => HeadTags | Promise<HeadTags> } };
}

const routes = import.meta.glob<RouteModule>("/app/routes/**/*.tsx", { eager: true });

async function collectHeads(): Promise<Array<[string, HeadTags]>> {
  const heads: Array<[string, HeadTags]> = [["NOT_FOUND_HEAD", NOT_FOUND_HEAD]];

  for (const [file, module] of Object.entries(routes)) {
    const head = module.Route?.options.head;

    if (head) heads.push([file, await head({ matches: [] })]);
  }

  return heads;
}

describe("page heads", () => {
  it("keep every rendered title and description within search snippet limits", async () => {
    const violations: string[] = [];

    for (const [file, head] of await collectHeads()) {
      for (const tag of head.meta ?? []) {
        if (tag?.title !== undefined && tag.title.length > MAX_TITLE) {
          violations.push(`${file}: title is ${tag.title.length} chars: ${tag.title}`);
        }

        if (tag?.name === "description" && (tag.content?.length ?? 0) > MAX_DESCRIPTION) {
          violations.push(`${file}: description is ${tag.content?.length} chars`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("covers every indexable page", async () => {
    const canonicals = new Set<string>();

    for (const [, head] of await collectHeads()) {
      for (const link of head.links ?? []) {
        if (link?.rel === "canonical" && link.href) canonicals.add(link.href);
      }
    }

    const indexable = [
      ...PUBLIC_PAGES.map((page) => (page.path === "/" ? SITE_ORIGIN : absoluteUrl(page.path))),
      ...blogPosts.map((post) => absoluteUrl(`/blog/${post.slug}`)),
    ];

    expect([...canonicals]).toEqual(expect.arrayContaining(indexable));
  });
});
