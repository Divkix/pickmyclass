import { verifyAdmin } from '@/lib/auth/admin'
import { getAllUsersWithWatchCount } from '@/lib/db/admin-queries'
import { UsersTable } from '@/components/admin/UsersTable'

/**
 * Admin Users List Page
 *
 * Displays all registered users with their watch counts and account status.
 * Requires admin authentication.
 */
export default async function AdminUsersPage() {
  // Verify admin access
  await verifyAdmin()

  // Fetch all users with watch counts
  const users = await getAllUsersWithWatchCount()

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Users</h1>
        <p className="text-muted-foreground">
          Total registered users: <span className="font-semibold">{users.length}</span>
        </p>
      </div>

      <UsersTable users={users} />

      {users.length > 0 && (
        <div className="mt-4 text-sm text-muted-foreground">
          Click on a user email to view detailed information
        </div>
      )}
    </div>
  )
}
