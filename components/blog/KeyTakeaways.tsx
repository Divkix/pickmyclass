import { Lightbulb } from 'lucide-react';

interface KeyTakeaway {
  text: string;
}

interface KeyTakeawaysProps {
  title?: string;
  items: KeyTakeaway[];
}

export function KeyTakeaways({ title = 'Key Takeaways', items }: KeyTakeawaysProps) {
  return (
    <div className="not-prose my-8 rounded-xl border border-accent/40 bg-accent/10 p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Lightbulb className="size-4" aria-hidden="true" />
        </span>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      </div>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={item.text} className="flex items-start gap-3 text-sm text-muted-foreground">
            <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {index + 1}
            </span>
            <span className="leading-relaxed">{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
