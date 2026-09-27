import Link from 'next/link';

interface RelatedArticle {
  href: string;
  title: string;
}

export function RelatedArticles({ articles }: { articles: RelatedArticle[] }) {
  return (
    <div className="not-prose mt-8 border-t border-border pt-6">
      <h2 className="text-sm font-semibold text-foreground mb-3">Related Articles</h2>
      <ul className="space-y-2 text-sm">
        {articles.map((article) => (
          <li key={article.href}>
            <Link
              href={article.href}
              className="text-primary hover:text-primary/80 transition-colors"
            >
              {article.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
