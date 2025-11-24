'use client';

import { BookOpen, LayoutDashboard, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Admin Navigation Component
 *
 * Client component to handle active route highlighting.
 * Uses usePathname to detect current route and apply active styles.
 */
export function AdminNavigation() {
  const pathname = usePathname();

  const navItems = [
    {
      href: '/admin',
      icon: <LayoutDashboard className="size-5" />,
      label: 'Dashboard',
      exact: true, // Only highlight on exact match
    },
    {
      href: '/admin/classes',
      icon: <BookOpen className="size-5" />,
      label: 'Classes',
      exact: false,
    },
    {
      href: '/admin/users',
      icon: <Users className="size-5" />,
      label: 'Users',
      exact: false,
    },
  ];

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
          <Link key={item.href} href={item.href} className="block">
            <Button
              variant={active ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'w-full justify-start gap-3 transition-colors',
                active
                  ? 'bg-primary/10 text-primary hover:bg-primary/20 font-semibold'
                  : 'hover:bg-accent'
              )}
            >
              {item.icon}
              {item.label}
            </Button>
          </Link>
        );
      })}
    </>
  );
}
