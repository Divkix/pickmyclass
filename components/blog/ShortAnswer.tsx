interface ShortAnswerProps {
  children: React.ReactNode;
}

export function ShortAnswer({ children }: ShortAnswerProps) {
  return (
    <div className="not-prose my-6 rounded-xl border border-primary/20 bg-primary/5 p-6">
      <p className="text-sm font-semibold text-primary mb-2">Short answer</p>
      <p className="text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}
