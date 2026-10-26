import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import * as classSearch from "@/app/routes/blog/asu-class-search";
import * as seatTracker from "@/app/routes/blog/asu-class-seat-tracker";
import * as registrationTips from "@/app/routes/blog/asu-registration-tips";
import * as transferRegistration from "@/app/routes/blog/asu-transfer-registration";
import * as waitlist from "@/app/routes/blog/asu-waitlist-guide";
import * as bestTracker from "@/app/routes/blog/best-asu-class-seat-tracker";
import * as fullClasses from "@/app/routes/blog/how-to-get-into-full-asu-classes";
import * as registration from "@/app/routes/blog/how-to-register-for-classes-at-asu";
import * as searchTips from "@/app/routes/blog/myasu-search-tips";
import { BlogPostHeader } from "@/components/blog/BlogPostHeader";
import { ComparisonTable } from "@/components/blog/ComparisonTable";
import { TableOfContents } from "@/components/blog/TableOfContents";
import { blogPosts } from "@/lib/blog/posts";
import { absoluteUrl } from "@/lib/seo/public-pages";
import type { PageHead } from "@/lib/seo/head";
import { renderWithRouter } from "../../helpers/render-with-router";

// Public pages render while Clerk is still loading during SSR.
vi.mock("@/lib/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, session: null, loading: true, signOut: async () => {} }),
}));

const pages = [
  bestTracker,
  classSearch,
  registration,
  seatTracker,
  fullClasses,
  registrationTips,
  waitlist,
  transferRegistration,
  searchTips,
];

function findReadTime(node: ReactNode): string | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; readTime?: string }>(child)) continue;

    if (child.type === BlogPostHeader) return child.props.readTime;
    const readTime = findReadTime(child.props.children);

    if (readTime) return readTime;
  }

  return undefined;
}

describe("blog rendering", () => {
  it("formats published and modified ISO dates in UTC", async () => {
    const html = await renderWithRouter(
      <BlogPostHeader
        breadcrumb="ASU Registration"
        title="Registration Guide"
        dateTime="2026-06-18T00:30:00Z"
        dateModified="2026-09-28T00:30:00Z"
        readTime="5 min read"
      />,
    );

    expect(html).toMatch(/<time dateTime="2026-06-18T00:30:00Z">June 18, 2026<\/time>/i);
    expect(html).toContain("Updated September 28, 2026");
  });

  it("renders native fragment links before hydration", () => {
    const html = renderToStaticMarkup(
      <TableOfContents
        items={[
          { id: "registration", text: "Registration", level: 2 },
          { id: "holds", text: "Clear holds", level: 3 },
        ]}
      />,
    );

    expect(html).toContain('href="#registration"');
    expect(html).toContain('href="#holds"');
    expect(html).toContain("Registration</a>");
    expect(html).toContain("Clear holds</a>");
    expect(html).not.toContain("<button");
  });

  it("renders string cells and highlights the selected row independently of cell data", () => {
    const html = renderToStaticMarkup(
      <ComparisonTable
        columns={[
          { key: "tool", label: "Tool" },
          { key: "alerts", label: "Alerts" },
        ]}
        rows={[
          { tool: "Manual search", alerts: "None" },
          { tool: "PickMyClass", alerts: "Email" },
        ]}
        highlightedRow="PickMyClass"
      />,
    );

    expect(html).toMatch(/<td[^>]*>Manual search<\/td>/);
    expect(html).toMatch(/<td[^>]*>None<\/td>/);
    expect(html).toMatch(/<tr class="[^"]*bg-primary\/5[^"]*"><td[^>]*>PickMyClass<\/td>/);
    expect(html).toMatch(/<td[^>]*>Email<\/td>/);
    expect(html.match(/<td\b/g)).toHaveLength(4);
  });

  it("uses each registry entry for reading time, description and article dates", async () => {
    for (const page of pages) {
      const head = page.Route.options.head;
      const component = page.Route.options.component;

      if (!head || !component) throw new Error("Blog route is missing its head or component");

      // SAFETY: Every static blog head ignores route context and returns pageHead directly.
      const getHead = head as () => PageHead;
      const metadata = getHead();
      const canonical = metadata?.links?.find((link) => link?.rel === "canonical")?.href;
      const post = blogPosts.find((entry) => absoluteUrl(`/blog/${entry.slug}`) === canonical);

      expect(post).toBeDefined();

      if (!post) throw new Error("Blog page is missing from the registry");

      const originalReadingTime = post.readingTime;
      const originalDateModified = post.dateModified;

      try {
        post.readingTime = "Registry reading time";
        // SAFETY: Every blog route component is an ordinary synchronous function with no props.
        const article = (component as () => ReactNode)();
        expect(findReadTime(article)).toBe(post.readingTime);
        expect(
          metadata?.meta?.find((tag) => tag && "name" in tag && tag.name === "description"),
        ).toMatchObject({ content: post.description });
        // Open Graph and serialized article dates share the registry's UTC dates.
        const publishedTime = `${post.publishedAt}T00:00:00Z`;
        const modifiedTime = post.dateModified ? `${post.dateModified}T00:00:00Z` : undefined;
        expect(
          metadata.meta.find(
            (tag) => tag && "property" in tag && tag.property === "article:published_time",
          ),
        ).toMatchObject({ content: publishedTime });

        const modifiedTag = metadata.meta.find(
          (tag) => tag && "property" in tag && tag.property === "article:modified_time",
        );

        if (modifiedTime) {
          expect(modifiedTag).toMatchObject({ content: modifiedTime });
        } else {
          expect(modifiedTag).toBeUndefined();
        }

        const html = await renderWithRouter(article);
        expect(html).toContain(post.readingTime);
        expect(html).toContain(`"datePublished":"${publishedTime}"`);

        if (modifiedTime) expect(html).toContain(`"dateModified":"${modifiedTime}"`);

        delete post.dateModified;
        expect(
          getHead().meta.find(
            (tag) => tag && "property" in tag && tag.property === "article:modified_time",
          ),
        ).toBeUndefined();
      } finally {
        post.readingTime = originalReadingTime;

        if (originalDateModified !== undefined) post.dateModified = originalDateModified;
      }
    }
  });
});
