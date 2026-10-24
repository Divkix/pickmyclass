import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import * as classSearch from "@/app/blog/asu-class-search/page";
import * as seatTracker from "@/app/blog/asu-class-seat-tracker/page";
import * as registrationTips from "@/app/blog/asu-registration-tips/page";
import * as transferRegistration from "@/app/blog/asu-transfer-registration/page";
import * as waitlist from "@/app/blog/asu-waitlist-guide/page";
import * as bestTracker from "@/app/blog/best-asu-class-seat-tracker/page";
import * as fullClasses from "@/app/blog/how-to-get-into-full-asu-classes/page";
import * as registration from "@/app/blog/how-to-register-for-classes-at-asu/page";
import * as searchTips from "@/app/blog/myasu-search-tips/page";
import { BlogPostHeader } from "@/components/blog/BlogPostHeader";
import { ComparisonTable } from "@/components/blog/ComparisonTable";
import { TableOfContents } from "@/components/blog/TableOfContents";
import { blogPosts } from "@/lib/blog/posts";

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
  it("formats published and modified ISO dates in UTC", () => {
    const html = renderToStaticMarkup(
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

  it("uses each registry entry for the article reading time and shared description", async () => {
    for (const page of pages) {
      const post = blogPosts.find(
        (entry) => `/blog/${entry.slug}` === page.metadata.alternates?.canonical,
      );

      expect(post).toBeDefined();

      if (!post) throw new Error("Blog page is missing from the registry");

      const originalReadingTime = post.readingTime;

      try {
        post.readingTime = "Registry reading time";
        expect(findReadTime(await page.default())).toBe(post.readingTime);
        expect(page.metadata.description).toBe(post.description);
      } finally {
        post.readingTime = originalReadingTime;
      }
    }
  });
});
