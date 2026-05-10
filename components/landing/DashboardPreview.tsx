'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, Clock, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { staggerContainer, staggerItem } from '@/lib/animations';

const sampleClasses = [
  {
    code: 'CSE 240',
    title: 'Intro to Programming Languages',
    section: '12345',
    instructor: 'Dr. Nakamura',
    seats: 3,
    status: 'available',
  },
  {
    code: 'MAT 265',
    title: 'Calculus for Engineers I',
    section: '23456',
    instructor: 'Staff',
    seats: 0,
    status: 'full',
  },
  {
    code: 'PHY 121',
    title: 'University Physics I',
    section: '34567',
    instructor: 'Dr. Chen',
    seats: 0,
    status: 'full',
  },
];

export function DashboardPreview() {
  return (
    <section className="border-b border-border bg-muted/20 px-6 py-20">
      <motion.div
        className="mx-auto max-w-5xl"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-100px' }}
        variants={staggerContainer}
      >
        <motion.div className="mb-12 text-center" variants={staggerItem}>
          <h2 className="mb-4 text-3xl font-semibold text-foreground sm:text-4xl">
            Your Dashboard, <span className="text-gradient">Ready to Go</span>
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Here&apos;s what you get the moment you sign up. No learning curve.
          </p>
        </motion.div>

        <motion.div variants={staggerItem}>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            {/* Dashboard header preview */}
            <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-foreground">My Watched Classes</span>
                <div className="flex items-center gap-1.5">
                  <div className="size-2 animate-pulse rounded-full bg-green-500" />
                  <span className="text-xs text-muted-foreground">Live</span>
                </div>
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="hidden sm:inline">
                  <strong className="text-foreground">5</strong> classes
                </span>
                <span className="text-green-600 dark:text-green-400">
                  <strong>2</strong> available
                </span>
                <span className="text-red-600 dark:text-red-400">
                  <strong>3</strong> full
                </span>
              </div>
            </div>

            {/* Sample class cards */}
            <div className="divide-y divide-border">
              {sampleClasses.map((cls) => (
                <div
                  key={cls.section}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <div className="flex items-start gap-3 sm:items-center">
                    <div
                      className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
                        cls.status === 'available'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}
                    >
                      {cls.status === 'available' ? (
                        <CheckCircle2 className="size-5" />
                      ) : (
                        <Clock className="size-5" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{cls.code}</span>
                        <span className="text-xs text-muted-foreground">#{cls.section}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">{cls.title}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pl-13 sm:pl-0">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <User className="size-3.5" />
                      <span className={cls.instructor === 'Staff' ? 'italic' : ''}>
                        {cls.instructor}
                      </span>
                    </div>
                    <Badge
                      variant={cls.status === 'available' ? 'default' : 'secondary'}
                      className={
                        cls.status === 'available'
                          ? 'bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400'
                      }
                    >
                      {cls.status === 'available' ? `${cls.seats} seats open` : 'Full'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            {/* Add more classes hint */}
            <div className="border-t border-dashed border-border bg-muted/30 px-4 py-3 text-center sm:px-6">
              <span className="text-sm text-muted-foreground">
                + Add more classes by section number
              </span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
