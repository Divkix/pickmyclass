export const dynamic = 'force-dynamic';

import { UsersTable } from '@/components/admin/UsersTable';
import { verifyAdmin } from '@/lib/auth/admin';
import { getUsersPage } from '@/lib/db/admin-queries';
import type { UserSortField } from '@/lib/db/admin-queries';

const PAGE_SIZE = 25;
const USER_SORT_FIELDS: readonly UserSortField[] = [
  'email',
  'created_at',
  'last_sign_in_at',
  'watch_count',
  'seat_emails',
  'instructor_emails',
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function param(searchParams: Record<string, string | string[] | undefined>, key: string): string {
  const v = searchParams[key];
  return typeof v === 'string' ? v : '';
}

function userSort(value: string): UserSortField {
  return USER_SORT_FIELDS.includes(value as UserSortField)
    ? (value as UserSortField)
    : 'created_at';
}

/**
 * Admin Users List Page
 *
 * Server component that reads page/sort/filter searchParams and calls
 * getUsersPage() (server-side paginated RPC). Only the current page of rows
 * is fetched — the full table is never loaded into the Worker.
 */
export default async function AdminUsersPage({ searchParams }: { searchParams?: SearchParams }) {
  // Verify admin access
  await verifyAdmin();

  const sp = (await searchParams) ?? {};

  const page = Math.max(1, Number(param(sp, 'page') || '1'));
  const sort = userSort(param(sp, 'sort'));
  const dir = param(sp, 'dir') === 'asc' ? 'asc' : 'desc';
  const search = param(sp, 'search');
  const role = (param(sp, 'role') || 'all') as 'all' | 'admin' | 'user';
  const verified = (param(sp, 'verified') || 'all') as 'all' | 'verified' | 'unverified';
  const watchCount = (param(sp, 'watchCount') || 'all') as 'all' | 'none' | '1-5' | '6-10' | '10+';

  const { rows, total } = await getUsersPage({
    page,
    pageSize: PAGE_SIZE,
    search,
    role,
    verified,
    watchCount,
    sort,
    dir,
  });

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-foreground mb-2">Users</h1>
        <p className="text-muted-foreground">
          Total registered users: <span className="font-semibold">{total}</span>
        </p>
      </div>

      <UsersTable
        users={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        sort={sort}
        dir={dir}
        search={search}
        role={role}
        verified={verified}
        watchCount={watchCount}
      />

      {rows.length > 0 && (
        <div className="mt-4 text-sm text-muted-foreground">
          Click on a user email to view detailed information
        </div>
      )}
    </div>
  );
}
