import type { Metadata } from "next";
import Link from "next/link";
import { BlogAuthor, BlogPostHeader, RelatedArticles, TableOfContents } from "@/components/blog";
import { Header } from "@/components/Header";
import { JsonLd } from "@/components/landing/JsonLd";

export const metadata: Metadata = {
  title: "ASU Waitlist Guide: Full Classes & No Waitlist",
  description:
    "Full ASU class? Check for a waitlist, next steps if none appears, and where to verify deadlines or seat restrictions. ASU guidance checked 28 Sep 2026.",
  alternates: {
    canonical: "/blog/asu-waitlist-guide",
  },
  openGraph: {
    title: "How to Add a Full ASU Class to the Waitlist (And What to Do If There's No Waitlist)",
    description:
      "ASU course waitlist guide: verify section-level options, deadlines and seat restrictions. Official ASU guidance checked 28 Sep 2026.",
    type: "article",
    publishedTime: "2026-04-26T00:00:00Z",
    modifiedTime: "2026-09-28T00:00:00Z",
    images: ["/og-image.png"],
  },
};

export const dynamic = "error";

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "How to Add a Full ASU Class to the Waitlist (And What to Do If There's No Waitlist)",
  description:
    "Full ASU class? Check for a waitlist, next steps if none appears, and where to verify deadlines or seat restrictions. ASU guidance checked 28 Sep 2026.",
  datePublished: "2026-04-26T00:00:00Z",
  dateModified: "2026-09-28T00:00:00Z",
  author: { "@type": "Person", name: "PickMyClass Team", url: "https://pickmyclass.app" },
  publisher: {
    "@type": "Organization",
    name: "PickMyClass",
    url: "https://pickmyclass.app",
  },
  mainEntityOfPage: "https://pickmyclass.app/blog/asu-waitlist-guide",
};

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://pickmyclass.app/" },
    { "@type": "ListItem", position: 2, name: "Blog", item: "https://pickmyclass.app/blog" },
    { "@type": "ListItem", position: 3, name: "ASU Waitlist Guide" },
  ],
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Does every full ASU class have a waitlist?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "I could not verify a university-wide waitlist policy in the official pages checked. Check the exact section’s current My ASU registration options or ask a registration site; do not infer a waitlist from the word “closed” or from another section’s options.",
      },
    },
    {
      "@type": "Question",
      name: "What happens after the add deadline?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "ASU says a Late Add requires instructor, department, and college approval. Check the course college’s current instructions and the academic calendar for the class’s deadline. Registrar guidance for enrollment after the deadline",
      },
    },
  ],
};

const tocItems = [
  { id: "check-waitlist", text: "Check the section’s registration options", level: 2 },
  { id: "waitlist-timer", text: "Is there a 24-hour waitlist rule?", level: 2 },
  { id: "no-waitlist", text: "If no waitlist appears", level: 2 },
  { id: "seat-restrictions", text: "Reserved seats and eligibility", level: 2 },
  { id: "faq", text: "Common questions", level: 2 },
];

export default function ASUWaitlistGuidePost() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 px-4 py-12 md:px-8">
        <article className="prose prose-neutral dark:prose-invert mx-auto max-w-3xl">
          <BlogPostHeader
            breadcrumb="ASU Waitlist Guide"
            title="How to Add a Full ASU Class to the Waitlist (And What to Do If There's No Waitlist)"
            dateTime="2026-04-26"
            date="April 26, 2026"
            updated="Updated September 28, 2026"
            readTime="5 min read"
          />

          <p className="text-lg text-muted-foreground leading-relaxed">
            In ASU&apos;s official pages checked, I could not verify one waitlist rule or a 24-hour
            response window for every full class. Check the exact section in{" "}
            <a
              href="https://registrar.asu.edu/faq/how-do-i-register-classes-how-do-i-dropaddswap-class"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              My ASU registration
            </a>{" "}
            and use only options shown there. If no waitlist appears—or seat eligibility is
            unclear—compare sections and contact the offering college or{" "}
            <a
              href="https://registrar.asu.edu/faq/who-can-i-contact-if-im-having-problems-registering-class"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              an ASU registration site
            </a>
            .
          </p>
          <p className="text-muted-foreground leading-relaxed">
            For a general walkthrough of finding sections and checking availability, see the{" "}
            <Link href="/blog/asu-class-search" className="text-primary hover:text-primary/80">
              ASU class-search guide
            </Link>
            .
          </p>
          <p className="text-sm text-muted-foreground">Last checked: 28 Sep 2026</p>

          <TableOfContents items={tocItems} />

          <h2 id="check-waitlist" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Choose the next step for your section
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-[44rem] w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col">What you see</th>
                  <th scope="col">What to do</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Waitlist offered</th>
                  <td>
                    Use a waitlist only when the signed-in registration flow explicitly offers it
                    for that section. Follow that screen’s instructions and confirm status in My
                    Classes. The Registrar documents the My ASU → My Classes → Registration path,
                    but the public page does not specify one universal waitlist button or response
                    timer.{" "}
                    <a
                      href="https://registrar.asu.edu/faq/how-do-i-register-classes-how-do-i-dropaddswap-class"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary/80"
                    >
                      ASU registration instructions
                    </a>
                  </td>
                </tr>
                <tr>
                  <th scope="row">No waitlist appears</th>
                  <td>
                    Compare other sections in ASU’s Schedule of Classes. The Registrar says you may
                    add a class through its add deadline; an add after that deadline is a Late Add
                    and requires instructor, department, and college approval.{" "}
                    <a
                      href="https://registrar.asu.edu/drop-add"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary/80"
                    >
                      Drop/add deadlines and instructions
                    </a>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Reserved or major-restricted seats</th>
                  <td>
                    Read the section details and any eligibility message; do not assume that a
                    listed seat is available to every student. ASU’s Registrar says prerequisites
                    appear in the Class Detail’s Enrollment Information section. For a Late Add, ASU
                    directs students to the course’s college; for initial registration, its FAQ
                    directs students to their major college.{" "}
                    <a
                      href="https://registrar.asu.edu/faq/how-do-i-find-pre-requisites-course"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary/80"
                    >
                      How to find course details
                    </a>{" "}
                    <a
                      href="https://registrar.asu.edu/faq/can-student-enroll-school-after-dropadd-deadline"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary/80"
                    >
                      College contact guidance
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 id="waitlist-timer" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Is there a 24-hour waitlist rule?
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            ASU’s Registrar says online registration is available 24 hours per day except during
            scheduled outages. That describes when the registration service is available; it does
            not establish a 24-hour response window for a waitlist offer. I could not verify a
            universal course waitlist timer in the official Registrar pages checked, so follow any
            deadline shown for your section and ask ASU if it is unclear.{" "}
            <a
              href="https://registrar.asu.edu/faq/how-do-i-register-classes-how-do-i-dropaddswap-class"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              Registrar registration FAQ
            </a>
          </p>

          <h2 id="no-waitlist" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            If no waitlist appears
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Search the Schedule of Classes for another section that fits your schedule, then use
            ASU’s current registration flow to check whether you can add it. Add deadlines are
            class-specific; check the official{" "}
            <a
              href="https://registrar.asu.edu/academic-calendar"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              academic calendar
            </a>{" "}
            and the dates shown for the section. If registration is blocked or the add deadline has
            passed, follow the Late Add instructions for the course’s college rather than assuming a
            waitlist will move you into the class.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            For optional availability alerts,{" "}
            <Link href="/" className="text-primary hover:text-primary/80 font-medium">
              PickMyClass
            </Link>{" "}
            says its tracker checks ASU’s class search every 30 minutes and emails when a watched
            section changes. It is not ASU registration: use My ASU to take any enrollment action.{" "}
            <a
              href="https://pickmyclass.app/faq"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              PickMyClass FAQ
            </a>
          </p>

          <h2 id="seat-restrictions" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Reserved seats and eligibility
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            A section’s seat count alone may not answer whether you are eligible. ASU’s Registrar
            directs students to the Class Detail’s Enrollment Information section for prerequisites;
            the public pages checked here do not spell out every reserved-seat rule. For
            registration problems, ASU lists registration sites on any campus. For a Late Add, the
            Registrar directs students to the course’s college; its FAQ directs students to their
            major college for initial registration.{" "}
            <a
              href="https://registrar.asu.edu/faq/who-can-i-contact-if-im-having-problems-registering-class"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              Find registration-site locations
            </a>{" "}
            <a
              href="https://registrar.asu.edu/faq/can-student-enroll-school-after-dropadd-deadline"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              College contact guidance
            </a>
          </p>
          <p className="text-muted-foreground leading-relaxed">
            After a class’s add deadline, ASU classifies enrollment as a Late Add and requires
            instructor, department, and college approval. The process varies by college, so use the
            applicable{" "}
            <a
              href="https://registrar.asu.edu/late-registration"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              Late Add instructions
            </a>
            .
          </p>

          <h2 id="faq" className="text-2xl font-semibold text-foreground mt-10 mb-4">
            Common questions
          </h2>
          <h3 className="text-xl font-semibold text-foreground mt-6 mb-2">
            Does every full ASU class have a waitlist?
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            I could not verify a university-wide waitlist policy in the official pages checked.
            Check the exact section’s current My ASU registration options or ask a registration
            site; do not infer a waitlist from the word “closed” or from another section’s options.
          </p>
          <h3 className="text-xl font-semibold text-foreground mt-6 mb-2">
            What happens after the add deadline?
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            ASU says a Late Add requires instructor, department, and college approval. Check the
            course college’s current instructions and the academic calendar for the class’s
            deadline.{" "}
            <a
              href="https://registrar.asu.edu/faq/can-student-enroll-school-after-dropadd-deadline"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              Registrar guidance for enrollment after the deadline
            </a>
          </p>

          <BlogAuthor
            name="PickMyClass Team"
            title="Independent ASU registration guide"
            bio="Confirm course-specific registration decisions with ASU."
          />

          <RelatedArticles
            articles={[
              {
                href: "/blog/how-to-get-into-full-asu-classes",
                title: "How to Get Into Full Classes at ASU: 7 Strategies That Work",
              },
              {
                href: "/blog/asu-class-seat-tracker",
                title: "ASU Class Seat Tracker: How to Get Notified When Seats Open",
              },
              {
                href: "/blog/asu-registration-tips",
                title: "ASU Registration Tips: Build Your Perfect Schedule",
              },
            ]}
          />
        </article>
      </main>

      <JsonLd data={articleSchema} />
      <JsonLd data={breadcrumbSchema} />
      <JsonLd data={faqSchema} />
    </div>
  );
}
