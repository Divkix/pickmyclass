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
    <img
      src="/favicon.svg"
      alt="PickMyClass Logo"
      className={cn(sizeClasses[size], 'w-auto', className)}
    />
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
