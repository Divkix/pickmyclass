import type { Metadata } from "next";
import {
  BlogAuthor,
  BlogPostHeader,
  ComparisonTable,
  RelatedArticles,
  TableOfContents,
} from "@/components/blog";
import { Header } from "@/components/Header";
import { JsonLd } from "@/components/landing/JsonLd";

export const metadata: Metadata = {
  title: "Best ASU Class Seat Tracker 2026: Free vs Paid",
  description:
    "Compare ASU seat trackers by published price, campus coverage, alert channel, check cadence and limits. Details checked September 28, 2026.",
  alternates: {
    canonical: "/blog/best-asu-class-seat-tracker",
  },
  openGraph: {
    title: "Best ASU Class Seat Tracker 2026: Free vs Paid",
    description:
      "Compare ASU seat trackers by published price, campus coverage, alert channel, check cadence and limits. Details checked September 28, 2026.",
    type: "article",
    publishedTime: "2026-06-18T00:00:00Z",
    modifiedTime: "2026-09-28T00:00:00Z",
    images: ["/og-image.png"],
  },
};

export const dynamic = "error";

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Best ASU Class Seat Tracker in 2026 (Free vs Paid)",
  description:
    "Compare ASU seat trackers by published price, campus coverage, alert channel, check cadence and limits. Details checked September 28, 2026.",
  datePublished: "2026-06-18T00:00:00Z",
  dateModified: "2026-09-28T00:00:00Z",
  author: { "@type": "Person", name: "PickMyClass Team", url: "https://pickmyclass.app" },
  publisher: {
    "@type": "Organization",
    name: "PickMyClass",
    url: "https://pickmyclass.app",
  },
  mainEntityOfPage: "https://pickmyclass.app/blog/best-asu-class-seat-tracker",
};

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://pickmyclass.app/" },
    { "@type": "ListItem", position: 2, name: "Blog", item: "https://pickmyclass.app/blog" },
    { "@type": "ListItem", position: 3, name: "Best ASU Class Seat Tracker" },
  ],
};

const tocItems = [
  { id: "comparison", text: "ASU trackers compared", level: 2 },
  { id: "method", text: "How to read the comparison", level: 2 },
  { id: "pick-a-class", text: "Pick A Class status", level: 2 },
  { id: "choose", text: "Which option fits your needs?", level: 2 },
  { id: "faq", text: "Common questions", level: 2 },
];

const comparisonColumns = [
  { key: "tool", label: "Tracker" },
  { key: "coverage", label: "Coverage and setup" },
  { key: "price", label: "Published price" },
  { key: "alerts", label: "Alert channel" },
  { key: "cadence", label: "Published check cadence" },
  { key: "limits", label: "Limits and caveats" },
];

const comparisonRows = [
  {
    tool: "PickMyClass",
    coverage: "ASU; search by section number and add sections to a watchlist.",
    price: "Free; no paid tiers listed.",
    alerts:
      "Email notifications for seat availability and instructor assignments; no SMS is listed on the pages checked.",
    cadence: "30 minutes (site claim; scheduler uses two staggered groups).",
    limits:
      "Email alerts only; you still register through ASU. Does not ask for MyASU credentials.",
    highlight: true,
  },
  {
    tool: "ASUClassFinder",
    coverage: "ASU; public pages describe monitoring selected classes.",
    price: "Basic $2/mo (1 class); Silver $3/mo (3); Gold $7/mo (10).",
    alerts: "Email and text; site advertises instant alerts.",
    cadence: "Site says 24/7 monitoring; exact polling interval not stated.",
    limits: "Plans cap the number of tracked classes; no delivery-time guarantee is stated.",
  },
  {
    tool: "SeatSignal",
    coverage: "ASU and Texas A&M; choose a school and track classes.",
    price:
      "Current amount not visible on the public purchase page checked. Its May 2023 post lists $2/$3/$5 per term (historical).",
    alerts: "Email and text with a direct enrollment link (ASU page).",
    cadence: "1-minute checks claimed on the ASU page; not independently timed.",
    limits:
      "The exact current price was not verified; older prices should not be treated as current.",
  },
  {
    tool: "Courseer",
    coverage: "ASU; add classes to a watchlist.",
    price: "Free: 1 class; Gold $4/mo (up to 4); Sparky $9/mo (up to 8).",
    alerts: "Text; plan-dependent delayed, priority, or instant notifications.",
    cadence: "Exact polling interval not stated; site says it tracks regularly.",
    limits: "The free plan says delayed texts may arrive up to 14 minutes after a seat opens.",
  },
  {
    tool: "Pick A Class (pickaclass.app)",
    coverage: "ASU seat-notification product historically; its own site now says it is closed.",
    price: "Not available as an active service.",
    alerts:
      "No current alerts; ASU News described the service as notifying students when a filled class had a spot.",
    cadence: "No current cadence published.",
    limits: "Not an active option on the 28 Sep 2026 check date.",
  },
  {
    tool: "Manual ASU search",
    coverage: "ASU; open the class search and check sections yourself.",
    price: "No tracker plan; you check manually.",
    alerts: "None from manual checking.",
    cadence: "Whenever you check.",
    limits: "No automatic notification; use ASU’s registration flow to enroll.",
  },
];

export default function BestASUSeatTrackerPost() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 px-4 py-12 md:px-8">
        <article className="prose prose-neutral dark:prose-invert mx-auto max-w-3xl">
          <BlogPostHeader
            breadcrumb="Best ASU Class Seat Tracker"
            title="Best ASU Class Seat Tracker in 2026 (Free vs Paid)"
            dateTime="2026-06-18"
            date="June 18, 2026"
            updated="Updated September 28, 2026"
            readTime="8 min read"
          />

          <p className="text-lg text-muted-foreground leading-relaxed">
            There is no single best tracker for every ASU student. PickMyClass lists free email
            alerts and a 30-minute check cycle; ASUClassFinder and SeatSignal publish text-alert
            options; and Courseer has a free one-class plan plus paid tiers. This independent
            comparison checks each vendor’s published price, coverage, setup, alert channel,
            cadence, and stated limits.
          </p>
          <p className="text-sm text-muted-foreground">Last checked: 28 Sep 2026</p>
          <p className="text-muted-foreground leading-relaxed">
            Disclosure: PickMyClass publishes this page and is included in the comparison.
            PickMyClass says it is not affiliated with, endorsed by, or sponsored by Arizona State
            University. The vendor descriptions below are self-reported; we did not independently
            measure alert delivery speed or verify enrollment outcomes.{" "}
            <a
              href="https://pickmyclass.app/faq"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              PickMyClass affiliation and service FAQ
            </a>
          </p>

          <TableOfContents items={tocItems} />

          <h2 id="comparison" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            ASU trackers compared
          </h2>
          <ComparisonTable
            columns={comparisonColumns}
            rows={comparisonRows}
            caption="Vendor-published claims checked 28 Sep 2026. ‘Not stated’ means the linked public pages did not specify it."
          />
          <h3 className="text-xl font-semibold text-foreground mt-6 mb-2">Primary sources</h3>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              PickMyClass:{" "}
              <a href="https://pickmyclass.app/" target="_blank" rel="noopener noreferrer">
                overview
              </a>{" "}
              and{" "}
              <a href="https://pickmyclass.app/faq" target="_blank" rel="noopener noreferrer">
                FAQ
              </a>
              .
            </li>
            <li>
              ASUClassFinder:{" "}
              <a href="https://www.asuclassfinder.com/" target="_blank" rel="noopener noreferrer">
                product page
              </a>{" "}
              and{" "}
              <a
                href="https://www.asuclassfinder.com/pricing/"
                target="_blank"
                rel="noopener noreferrer"
              >
                pricing page
              </a>
              .
            </li>
            <li>
              SeatSignal:{" "}
              <a href="https://seatsignal.com/" target="_blank" rel="noopener noreferrer">
                school list
              </a>
              ,{" "}
              <a
                href="https://seatsignal.com/arizona-state"
                target="_blank"
                rel="noopener noreferrer"
              >
                ASU product page
              </a>
              ,{" "}
              <a href="https://seatsignal.com/purchase" target="_blank" rel="noopener noreferrer">
                purchase page
              </a>
              , and{" "}
              <a
                href="https://seatsignal.com/blog/introducing-seatsignal"
                target="_blank"
                rel="noopener noreferrer"
              >
                May 2023 product post
              </a>
              .
            </li>
            <li>
              Courseer:{" "}
              <a href="https://courseer.co/" target="_blank" rel="noopener noreferrer">
                current product and plan details
              </a>
              .
            </li>
            <li>
              Pick A Class:{" "}
              <a
                href="https://news.asu.edu/20231205-entrepreneurship-entrepreneurial-ventures-win-more-100k-funding-asu-demo-day"
                target="_blank"
                rel="noopener noreferrer"
              >
                ASU News product description
              </a>{" "}
              and{" "}
              <a href="https://www.pickaclass.app/" target="_blank" rel="noopener noreferrer">
                the product’s closure notice
              </a>
              .
            </li>
            <li>
              Manual registration:{" "}
              <a
                href="https://registrar.asu.edu/faq/how-do-i-register-classes-how-do-i-dropaddswap-class"
                target="_blank"
                rel="noopener noreferrer"
              >
                ASU Registrar instructions
              </a>
              .
            </li>
          </ul>

          <h2 id="method" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            How to read the comparison
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            We compared public product and pricing pages, not hands-on timing tests. A vendor’s
            “instant” or “real-time” wording is presented as its claim, not a guarantee. For
            SeatSignal, the current purchase route did not show a price before sign-in; the older
            vendor post is labeled historical rather than treated as a current plan. Prices and plan
            details can change after this check.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            PickMyClass’s 30-minute claim was also checked against the repository’s schedule: the
            section workflow runs on 15-minute triggers and alternates two groups, so each group is
            scheduled every 30 minutes. The change detector and notification sender cover newly
            available seats and assigned instructors. See <code>wrangler.jsonc</code>,{" "}
            <code>lib/workflows/cron-workflows.ts</code>, <code>lib/queue/change-detector.ts</code>,
            and <code>lib/queue/notification-sender.ts</code>.
          </p>

          <h2 id="pick-a-class" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Pick A Class status
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            “Pick A Class” was a real ASU student venture: ASU News described it in 2023 as a
            platform that notified students when a spot opened in a filled class. Its own site now
            says the service is closed and gives a refund deadline of October 1, 2025, so it is not
            an active tracker on this page’s check date. It is different from{" "}
            <a
              href="https://pickaclass.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              PickAClass.com
            </a>
            , whose current homepage describes an online learning-course catalog, not an ASU seat
            tracker.
          </p>

          <h2 id="choose" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Which option fits your needs?
          </h2>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              If free email notifications and a stated 30-minute check cycle fit, compare
              PickMyClass’s{" "}
              <a
                href="https://pickmyclass.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80"
              >
                published details
              </a>{" "}
              with the other services’ plan limits.
            </li>
            <li>
              If you specifically want text alerts, compare the current plan prices and published
              cadence for{" "}
              <a
                href="https://www.asuclassfinder.com/pricing/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80"
              >
                ASUClassFinder
              </a>
              ,{" "}
              <a
                href="https://seatsignal.com/arizona-state"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80"
              >
                SeatSignal
              </a>
              , and{" "}
              <a
                href="https://courseer.co/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80"
              >
                Courseer
              </a>
              . SeatSignal’s current public price was not verifiable at this check.
            </li>
            <li>
              If you only need to look up a section, use ASU’s{" "}
              <a
                href="https://registrar.asu.edu/faq/how-do-i-register-classes-how-do-i-dropaddswap-class"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80"
              >
                registration instructions
              </a>{" "}
              and verify enrollment in My ASU. An alert tells you to check a seat; it does not
              enroll you.
            </li>
          </ul>

          <h2 id="faq" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Common questions
          </h2>
          <h3 className="text-xl font-semibold text-foreground mt-6 mb-2">
            Which tracker is fastest?
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            The published claims are not a controlled speed test. SeatSignal says it checks each
            minute; PickMyClass lists 30 minutes; ASUClassFinder says it monitors 24/7 but does not
            state an exact interval; and Courseer does not publish an exact check interval on its
            page. The linked sources above show what each vendor states.
          </p>
          <h3 className="text-xl font-semibold text-foreground mt-6 mb-2">
            Will a tracker register me when a seat opens?
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            No. These services describe notifications so you can act; use ASU’s own registration
            flow to enroll. Seat availability can change before you complete registration.
          </p>
          <h3 className="text-xl font-semibold text-foreground mt-6 mb-2">
            Is Pick A Class still available?
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            No. The{" "}
            <a
              href="https://www.pickaclass.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              Pick A Class site
            </a>{" "}
            says it is closed. The online learning catalog at{" "}
            <a
              href="https://pickaclass.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              PickAClass.com
            </a>{" "}
            is a separate, similarly named service.
          </p>

          <BlogAuthor
            name="PickMyClass Team"
            title="Independent product comparison"
            bio="Sources, dates, and comparison limits are shown above."
          />

          <RelatedArticles
            articles={[
              {
                href: "/blog/asu-class-seat-tracker",
                title: "ASU Class Seat Tracker: How to Get Notified When Seats Open",
              },
              {
                href: "/blog/how-to-get-into-full-asu-classes",
                title: "How to Get Into Full Classes at ASU: 7 Strategies That Work",
              },
              {
                href: "/blog/asu-waitlist-guide",
                title: "How to Add a Full ASU Class to the Waitlist",
              },
            ]}
          />
        </article>
      </main>

      <JsonLd data={articleSchema} />
      <JsonLd data={breadcrumbSchema} />
    </div>
  );
}
