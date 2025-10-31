import { verifyAdmin } from '@/lib/auth/admin'
import { getAllUsersWithWatchCount } from '@/lib/db/admin-queries'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

/**
 * Format date to readable format
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never'

  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  // If less than 7 days ago, show relative time
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60))
      return diffMinutes <= 1 ? 'Just now' : `${diffMinutes} minutes ago`
    }
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`
  }

  if (diffDays < 7) {
    return diffDays === 1 ? 'Yesterday' : `${diffDays} days ago`
  }

  // Otherwise show formatted date
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

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

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Email</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead>Last Sign In</TableHead>
              <TableHead>Email Verified</TableHead>
              <TableHead className="text-center">Watches</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => {
                const isVerified = !!user.email_confirmed_at

                return (
                  <TableRow
                    key={user.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-sm"
                      >
                        {user.email}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-sm">
                        {formatDate(user.created_at)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-sm">
                        {formatDate(user.last_sign_in_at)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={isVerified ? 'success' : 'warning'} size="sm">
                        {isVerified ? 'Verified' : 'Unverified'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-semibold text-foreground">{user.watch_count}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="default" size="sm">
                        Active
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {users.length > 0 && (
        <div className="mt-4 text-sm text-muted-foreground">
          Click on a user email to view detailed information
        </div>
      )}
    </div>
  )
}
