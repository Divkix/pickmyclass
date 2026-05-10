'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LogoProps {
  variant?: 'full' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 32,
  md: 40,
  lg: 48,
};

// Hoisted static wordmark so it's not recreated each render
const Wordmark = (
  <span className="ml-2 text-xl font-bold tracking-tight">
    Pick<span className="text-primary">My</span>Class
  </span>
);

export function Logo({ variant = 'full', size = 'md', className }: LogoProps) {
  const pixelSize = sizeMap[size];

  return (
    <div className={cn('flex items-center', className)}>
      <Image
        src="/favicon.svg"
        alt="PickMyClass Logo"
        width={pixelSize}
        height={pixelSize}
        className="w-auto h-auto"
        priority
        unoptimized
      />
      {variant === 'full' && Wordmark}
    </div>
  );
}
