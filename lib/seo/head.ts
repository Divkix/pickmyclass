import type { AnyRouteMatch } from "@tanstack/react-router";
import { SITE_ORIGIN, absoluteUrl } from "@/lib/seo/public-pages";

type HeadMeta = NonNullable<AnyRouteMatch["meta"]>;

type HeadLinks = NonNullable<AnyRouteMatch["links"]>;

export interface PageHead {
  meta: HeadMeta;
  links: HeadLinks;
}

const SITE_NAME = "PickMyClass";
const DEFAULT_TITLE = "PickMyClass — Free ASU Class Seat Tracker & Open Seat Alerts";
const OG_IMAGE = absoluteUrl("/og-image.png");

/**
 * Site-wide head for the root route. TanStack keeps the deepest match's meta
 * per `name`/`property`, so page heads override these. Links are not deduped:
 * canonical and robots stay out of here and come from `pageHead` only, or
 * every page would inherit the homepage's.
 */
export const SITE_META: HeadMeta = [
  { charSet: "utf-8" },
  { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=5" },
  { title: DEFAULT_TITLE },
  {
    name: "description",
    content:
      "Get a free email the moment a seat opens in a full ASU class. PickMyClass checks every 30 minutes so you stop refreshing MyASU. Trusted by 2,400+ Sun Devils.",
  },
  { name: "theme-color", content: "#8C1D40" },
  { name: "author", content: SITE_NAME },
  { name: "creator", content: SITE_NAME },
  { name: "is-agentic-site-type", content: "app" },
  { property: "og:type", content: "website" },
  { property: "og:site_name", content: SITE_NAME },
  { property: "og:locale", content: "en_US" },
  { property: "og:image", content: OG_IMAGE },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { property: "og:image:alt", content: DEFAULT_TITLE },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:image", content: OG_IMAGE },
];

export const SITE_LINKS: HeadLinks = [
  { rel: "icon", href: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/manifest.webmanifest" },
];

/** Signed-in pages: the site title, kept out of search. */
export const PRIVATE_PAGE_HEAD = { meta: [{ name: "robots", content: "noindex, nofollow" }] };

interface SocialCard {
  title?: string;
  description?: string;
  type?: "article";
  card?: "summary";
  publishedTime?: string;
  modifiedTime?: string;
}

type PageTitle =
  /** Rendered as `title | PickMyClass`. */
  | { title: string }
  /** Rendered as is, for titles that already name the brand. */
  | { absoluteTitle: string };

type PageHeadInput = PageTitle & {
  description: string;
  /** Canonical path; omit it on pages kept out of search. */
  path?: string;
  /** Pages kept out of search. Indexable pages get `index, follow` plus the googlebot directives. */
  robots?: "noindex, follow" | "noindex, nofollow";
  /** Open Graph and Twitter card; title and description default to the page's own. */
  social?: SocialCard;
};

/** The `head` of one page: title, description, robots, canonical and social card. */
export function pageHead(page: PageHeadInput): PageHead {
  const title = "absoluteTitle" in page ? page.absoluteTitle : `${page.title} | ${SITE_NAME}`;
  const socialTitle = page.social?.title ?? title;
  const socialDescription = page.social?.description ?? page.description;

  // The homepage's canonical is the bare origin, as it was under Next's metadataBase.
  const url =
    page.path === undefined ? undefined : page.path === "/" ? SITE_ORIGIN : absoluteUrl(page.path);

  const robots: HeadMeta = page.robots
    ? [{ name: "robots", content: page.robots }]
    : [
        { name: "robots", content: "index, follow" },
        {
          name: "googlebot",
          content: "index, follow, max-video-preview:-1, max-image-preview:large, max-snippet:-1",
        },
      ];

  return {
    meta: [
      { title },
      { name: "description", content: page.description },
      ...robots,
      { property: "og:title", content: socialTitle },
      { property: "og:description", content: socialDescription },
      { property: "og:type", content: page.social?.type ?? "website" },
      url && { property: "og:url", content: url },
      page.social?.publishedTime && {
        property: "article:published_time",
        content: page.social.publishedTime,
      },
      page.social?.modifiedTime && {
        property: "article:modified_time",
        content: page.social.modifiedTime,
      },
      page.social?.card && { name: "twitter:card", content: page.social.card },
      { name: "twitter:title", content: socialTitle },
      { name: "twitter:description", content: socialDescription },
    ].filter((tag) => tag !== undefined && tag !== ""),
    links: url ? [{ rel: "canonical", href: url }] : [],
  };
}

export const NOT_FOUND_HEAD = pageHead({
  absoluteTitle: "Page Not Found — PickMyClass",
  description:
    "The page you were looking for doesn't exist. Return to PickMyClass, the free ASU class seat notification service.",
  robots: "noindex, follow",
});
