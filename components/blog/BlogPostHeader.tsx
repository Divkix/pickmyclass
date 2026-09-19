import Link from 'next/link';

interface BlogPostHeaderProps {
  breadcrumb: string;
  title: string;
  dateTime: string;
  date: string;
  readTime: string;
  updated?: string;
}

export function BlogPostHeader({
  breadcrumb,
  title,
  dateTime,
  date,
  readTime,
  updated,
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
          <time dateTime={dateTime}>{date}</time>
          {updated && (
            <>
              <span>·</span>
              <span>{updated}</span>
            </>
          )}
          <span>{readTime}</span>
        </div>
      </div>
    </>
  );
}
