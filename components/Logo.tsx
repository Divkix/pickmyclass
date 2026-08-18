import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LogoProps {
  variant?: 'full' | 'icon';
  size?: 'sm' | 'md';
  className?: string;
}

const sizeClasses = {
  sm: 'h-8',
  md: 'h-10',
};
export function Logo({ variant = 'full', size = 'md', className }: LogoProps) {
  const iconContent = (
    <Image
      src="/favicon.svg"
      alt="PickMyClass Logo"
      width={40}
      height={40}
      className={cn(sizeClasses[size], 'w-auto', className)}
      unoptimized
    />
  );

  const wordmark = (
    <span className="ml-2 text-xl font-bold tracking-tight">
      Pick<span className="text-primary">My</span>Class
    </span>
  );

  return (
    <div className="flex items-center">
      {iconContent}
      {variant === 'full' && wordmark}
    </div>
  );
}
