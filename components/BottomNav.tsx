'use client';

import { Home, PlusCircle, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { cn } from '@/lib/utils';

export function BottomNav() {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  if (loading || !user) return null;

  const navItems = [
    {
      label: 'Dashboard',
      icon: Home,
      href: '/dashboard',
      isFab: false,
      active: pathname === '/dashboard',
    },
    {
      label: 'Add Class',
      icon: PlusCircle,
      href: '/dashboard/add',
      isFab: true,
      active: pathname === '/dashboard/add',
    },
    {
      label: 'Settings',
      icon: Settings,
      href: '/settings',
      isFab: false,
      active: pathname === '/settings',
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden" aria-label="Mobile navigation">
      <div
        className="border-t border-border/40 bg-background/80 backdrop-blur-lg"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)',
        }}
      >
        <div className="flex items-center justify-around px-4 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  item.isFab
                    ? 'relative -top-4 size-16 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-[transform] duration-200 hover:scale-105 active:scale-95 focus-visible:ring-offset-2'
                    : 'min-w-16 rounded-lg px-4 py-2 transition-colors duration-200',
                  !item.isFab &&
                    (item.active
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')
                )}
                aria-label={item.label}
                aria-current={item.active ? 'page' : undefined}
              >
                <Icon className="size-6" aria-hidden="true" />
                {!item.isFab && <span className="text-[10px] font-medium">{item.label}</span>}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
