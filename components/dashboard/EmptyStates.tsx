'use client';

import { m } from 'framer-motion';
import { Calendar, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { fadeInUp } from '@/lib/animations';

export function EmptyWatchlist() {
  return (
    <m.div
      className="text-center py-16 bg-muted/20 rounded-xl border-2 border-dashed border-border"
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
    >
      <div className="flex size-12 sm:size-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-4">
        <Calendar className="size-6 sm:size-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">Your watchlist is empty</h3>
      <p className="text-muted-foreground mb-4 max-w-sm mx-auto">
        Add your first class and we'll start refreshing MyASU for you. No more F5 spam.
      </p>
      <p className="text-sm text-muted-foreground mb-6">
        Join <span className="font-semibold text-asu-maroon">2,400+</span> Sun Devils already using
        PickMyClass
      </p>
      <Link href="/dashboard/add">
        <Button variant="gradient">
          <Plus className="size-4" />
          Add Your First Class
        </Button>
      </Link>
    </m.div>
  );
}

export function NoSearchResults() {
  return (
    <m.div className="text-center py-12" initial="hidden" animate="visible" variants={fadeInUp}>
      <Search className="size-12 text-muted-foreground mx-auto mb-4" />
      <h3 className="text-lg font-semibold mb-2">No results found</h3>
      <p className="text-muted-foreground">Try adjusting your search query</p>
    </m.div>
  );
}
