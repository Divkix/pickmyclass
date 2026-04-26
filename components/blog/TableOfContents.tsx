'use client';

import { useEffect, useState } from 'react';

interface TOCItem {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  items: TOCItem[];
}

export function TableOfContents({ items }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: '-20% 0% -80% 0%' }
    );

    items.forEach((item) => {
      const element = document.getElementById(item.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [items]);

  const handleClick = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="not-prose rounded-lg border border-border bg-card p-6 my-8">
      <h3 className="font-semibold text-foreground mb-4">Table of Contents</h3>
      <nav className="space-y-2">
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => handleClick(item.id)}
            className={`block text-left text-sm transition-colors hover:text-primary ${
              item.level === 2 ? '' : 'ml-4'
            } ${activeId === item.id ? 'text-primary font-medium' : 'text-muted-foreground'}`}
          >
            {item.text}
          </button>
        ))}
      </nav>
    </div>
  );
}
