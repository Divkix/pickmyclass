"use client";

import { useEffect, useState } from "react";

interface TOCItem {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  items: TOCItem[];
}

export function TableOfContents({ items }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0% -80% 0%" },
    );

    items.forEach((item) => {
      const element = document.getElementById(item.id);

      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [items]);

  return (
    <div className="not-prose rounded-lg border border-border bg-card p-6 my-8">
      <h2 className="font-semibold text-foreground mb-4">Table of Contents</h2>
      <nav className="space-y-2">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={`block text-sm transition-colors hover:text-primary ${
              item.level === 2 ? "" : "ml-4"
            } ${activeId === item.id ? "text-primary font-medium" : "text-muted-foreground"}`}
          >
            {item.text}
          </a>
        ))}
      </nav>
    </div>
  );
}
