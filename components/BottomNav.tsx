'use client';

import { Home, PlusCircle, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface BottomNavProps {
  onAddClass?: () => void;
}

export function BottomNav({ onAddClass }: BottomNavProps) {
  const pathname = usePathname();

  const navItems = [
    {
      label: 'Dashboard',
      icon: Home,
      href: '/dashboard',
      active: pathname === '/dashboard',
    },
    {
      label: 'Add Class',
      icon: PlusCircle,
      href: '/dashboard/add',
      onClick: onAddClass,
      isFab: true,
      active: pathname === '/dashboard/add',
    },
    {
      label: 'Settings',
      icon: Settings,
      href: '/settings',
      active: pathname === '/settings',
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden" aria-label="Mobile navigation">
      {/* Safe area padding for notched devices */}
      <div
        className="border-t border-border/40 bg-background/80 backdrop-blur-lg"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)',
        }}
      >
        <div className="flex items-center justify-around px-4 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.active;
            const isFab = item.isFab;

            // Floating Action Button (center button)
            if (isFab) {
              if (item.onClick) {
                return (
                  <button
                    key={item.label}
                    onClick={item.onClick}
                    type="button"
                    className={cn(
                      'flex flex-col items-center justify-center gap-1',
                      'relative -top-4',
                      'size-16 rounded-full',
                      'bg-primary text-primary-foreground',
                      'shadow-lg shadow-primary/25',
                      'transition-all duration-200',
                      'hover:scale-105 active:scale-95',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                    )}
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className="size-6" aria-hidden="true" />
                  </button>
                );
              }

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1',
                    'relative -top-4',
                    'size-16 rounded-full',
                    'bg-primary text-primary-foreground',
                    'shadow-lg shadow-primary/25',
                    'transition-all duration-200',
                    'hover:scale-105 active:scale-95',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                  )}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="size-6" aria-hidden="true" />
                </Link>
              );
            }

            // Regular navigation buttons
            if (item.onClick) {
              return (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  type="button"
                  className={cn(
                    'flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-lg min-w-16',
                    'transition-all duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="size-6" aria-hidden="true" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              );
            }

            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-lg min-w-16',
                  'transition-all duration-200',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="size-6" aria-hidden="true" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
