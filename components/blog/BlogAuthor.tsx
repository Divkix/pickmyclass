import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface BlogAuthorProps {
  name: string;
  title: string;
  bio: string;
  year?: string;
}

export function BlogAuthor({ name, title, bio, year }: BlogAuthorProps) {
  return (
    <div className="not-prose flex items-start gap-4 rounded-lg border border-border bg-card p-6 my-8">
      <Avatar className="size-12">
        <AvatarFallback className="bg-primary/10 text-primary font-semibold">
          {name
            .split(' ')
            .map((n) => n[0])
            .join('')}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-foreground">{name}</span>
          {year && (
            <span className="text-sm text-muted-foreground">
              ASU {year} & {title}
            </span>
          )}
          {!year && <span className="text-sm text-muted-foreground">{title}</span>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{bio}</p>
      </div>
    </div>
  );
}
