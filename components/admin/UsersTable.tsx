'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { UserWithWatchCount } from '@/lib/db/admin-queries'

interface UsersTableProps {
  users: UserWithWatchCount[]
}

/**
 * Format date to readable format with relative time
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
 * Admin Users Table Component
 *
 * Client component for displaying all users with navigation support.
 * Handles row clicks to navigate to user detail pages.
 */
export function UsersTable({ users }: UsersTableProps) {
  const router = useRouter()

  const handleRowClick = (userId: string, event: React.MouseEvent) => {
    // Don't navigate if user clicked on the email link
    const target = event.target as HTMLElement
    if (target.tagName === 'A' || target.closest('a')) {
      return
    }

    router.push(`/admin/users/${userId}`)
  }

  return (
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
                  onClick={(e) => handleRowClick(user.id, e)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {user.email}
                      </Link>
                      {user.is_admin && (
                        <Badge variant="destructive" className="text-xs">
                          Admin
                        </Badge>
                      )}
                    </div>
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
  )
}
