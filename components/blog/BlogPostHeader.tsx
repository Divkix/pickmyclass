import Link from "next/link";
import { formatAbsoluteDate } from "@/lib/utils/time-format";

const dateFormat: Intl.DateTimeFormatOptions = { month: "long", timeZone: "UTC" };

interface BlogPostHeaderProps {
  breadcrumb: string;
  title: string;
  dateTime: string;
  readTime: string;
  dateModified?: string;
}

export function BlogPostHeader({
  breadcrumb,
  title,
  dateTime,
  readTime,
  dateModified,
}: BlogPostHeaderProps) {
  return (
    <>
      <div className="not-prose mb-4">
        <nav className="text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            Home
          </Link>
          <span className="mx-2">/</span>
          <Link href="/blog" className="hover:text-foreground transition-colors">
            Blog
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{breadcrumb}</span>
        </nav>
      </div>

      <div className="not-prose mb-8">
        <h1 className="text-4xl font-semibold text-foreground sm:text-5xl leading-tight">
          {title}
        </h1>
        <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
          <time dateTime={dateTime}>{formatAbsoluteDate(dateTime, dateFormat)}</time>
          {dateModified && (
            <>
              <span>·</span>
              <span>Updated {formatAbsoluteDate(dateModified, dateFormat)}</span>
            </>
          )}
          <span>{readTime}</span>
        </div>
      </div>
    </>
  );
}
