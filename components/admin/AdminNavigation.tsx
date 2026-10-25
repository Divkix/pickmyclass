import { BookOpen, LayoutDashboard, Users } from "lucide-react";
import { Link, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AdminNavigation() {
  const pathname = useLocation({ select: (location) => location.pathname });

  const navItems = [
    {
      href: "/admin",
      icon: <LayoutDashboard className="size-5" />,
      label: "Dashboard",
      exact: true,
    },
    {
      href: "/admin/classes",
      icon: <BookOpen className="size-5" />,
      label: "Classes",
      exact: false,
    },
    {
      href: "/admin/users",
      icon: <Users className="size-5" />,
      label: "Users",
      exact: false,
    },
    // SAFETY: Admin targets are fixed route literals, not user-provided URLs.
  ] as const;

  const isActive = (href: string, exact: boolean) => {
    if (exact) {
      return pathname === href;
    }

    return pathname.startsWith(href);
  };

  return (
    <>
      {navItems.map((item) => {
        const active = isActive(item.href, item.exact);

        return (
          <Button
            key={item.href}
            asChild
            variant={active ? "secondary" : "ghost"}
            size="sm"
            className={cn(
              "w-full justify-start gap-3 transition-colors",
              active
                ? "bg-primary/10 text-primary hover:bg-primary/20 font-semibold"
                : "hover:bg-accent",
            )}
          >
            <Link to={item.href} aria-current={active ? "page" : undefined}>
              {item.icon}
              {item.label}
            </Link>
          </Button>
        );
      })}
    </>
  );
}
