export const dynamic = 'force-dynamic';

import { ClassesTable } from '@/components/admin/ClassesTable';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { verifyAdmin } from '@/lib/auth/admin';
import { getClassesPage, getDistinctSubjects } from '@/lib/db/admin-queries';
import type { ClassSortField } from '@/lib/db/admin-queries';
import { getDbFromEnv } from '@/lib/db';
import { param, parsePageParam } from '@/lib/utils/page-params';

const PAGE_SIZE = 25;
const CLASS_SORT_FIELDS: readonly ClassSortField[] = [
  'class_nbr',
  'subject',
  'seats_available',
  'watcher_count',
  'seat_emails',
  'instructor_emails',
  'last_checked_at',
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function isClassSortField(value: string): value is ClassSortField {
  // SAFETY: readonly widen only; includes() narrows back to ClassSortField, 'watcher_count' fallback preserves invariant
  return (CLASS_SORT_FIELDS as readonly string[]).includes(value);
}

function classSort(value: string): ClassSortField {
  return isClassSortField(value) ? value : 'watcher_count';
}

export default async function AdminClassesPage({ searchParams }: { searchParams?: SearchParams }) {
  const db = getDbFromEnv();

  await verifyAdmin(db);

  const sp = (await searchParams) ?? {};

  const page = parsePageParam(param(sp, 'page'));
  const sort = classSort(param(sp, 'sort'));
  const dir = param(sp, 'dir') === 'asc' ? 'asc' : 'desc';
  const search = param(sp, 'search');
  const subject = param(sp, 'subject') || 'all';
  // SAFETY: param helper + 'all' fallback keeps allowed union; DB handles invalid gracefully
  const seatStatus = (param(sp, 'seatStatus') || 'all') as 'all' | 'full' | 'limited' | 'available';
  // SAFETY: param helper + 'all' fallback keeps allowed union; DB handles invalid gracefully
  const instructor = (param(sp, 'instructor') || 'all') as 'all' | 'staff' | 'named';
  // SAFETY: param helper + 'all' fallback keeps allowed union; DB handles invalid gracefully
  const watcherCount = (param(sp, 'watcherCount') || 'all') as
    | 'all'
    | 'none'
    | '1-5'
    | '6-10'
    | '10+';

  const [{ rows, total, totalWatchers, fullClasses }, subjects] = await Promise.all([
    getClassesPage(db, {
      page,
      pageSize: PAGE_SIZE,
      search,
      subject,
      seatStatus,
      instructor,
      watcherCount,
      sort,
      dir,
    }),
    getDistinctSubjects(db),
  ]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold mb-2">All Classes</h1>
        <p className="text-muted-foreground">
          View all classes being monitored across the platform
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sections Tracked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Includes sections with no current watchers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Watchers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalWatchers}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Full Classes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{fullClasses}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Classes Being Watched</CardTitle>
          <CardDescription>Click on a class number to view detailed information</CardDescription>
        </CardHeader>
        <CardContent>
          <ClassesTable
            classes={rows}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            subjects={subjects}
            sort={sort}
            dir={dir}
            search={search}
            subject={subject}
            seatStatus={seatStatus}
            instructor={instructor}
            watcherCount={watcherCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
