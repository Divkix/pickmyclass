'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface LogoProps {
  variant?: 'full' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  animated?: boolean;
}

const sizeClasses = {
  sm: 'h-8',
  md: 'h-10',
  lg: 'h-12',
};

export function Logo({ variant = 'full', size = 'md', className, animated = false }: LogoProps) {
  const iconContent = (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(sizeClasses[size], 'w-auto', className)}
      aria-label="PickMyClass Logo"
    >
      {/* Graduation Cap Base */}
      <path d="M20 8L4 14L20 20L36 14L20 8Z" className="fill-primary" opacity="0.9" />
      <path
        d="M20 20L8 15V22C8 24.2091 13.3726 26 20 26C26.6274 26 32 24.2091 32 22V15L20 20Z"
        className="fill-primary"
        opacity="0.7"
      />

      {/* Tassel */}
      <circle cx="20" cy="8" r="1.5" className="fill-accent" />
      <path d="M20 8V12" className="stroke-accent" strokeWidth="1.5" strokeLinecap="round" />

      {/* Notification Bell - positioned top right */}
      <g transform="translate(26, 4)">
        <path
          d="M6 6C6 3.79086 4.20914 2 2 2C-0.209139 2 -2 3.79086 -2 6C-2 7.86384 -0.804738 9.42994 0.857864 9.87398V12C0.857864 13.1046 1.75329 14 2.85786 14C3.96243 14 4.85786 13.1046 4.85786 12V9.87398C6.52047 9.42994 7.71573 7.86384 7.71573 6H6Z"
          className="fill-accent"
          opacity="0.9"
        />
        <circle cx="6" cy="1" r="2" className="fill-destructive animate-pulse" />
      </g>
    </svg>
  );

  const wordmark = (
    <span className="ml-2 text-xl font-bold tracking-tight">
      Pick<span className="text-primary">My</span>Class
    </span>
  );

  if (animated) {
    return (
      <motion.div
        className="flex items-center"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        {iconContent}
        {variant === 'full' && wordmark}
      </motion.div>
    );
  }

  return (
    <div className="flex items-center">
      {iconContent}
      {variant === 'full' && wordmark}
    </div>
  );
}
