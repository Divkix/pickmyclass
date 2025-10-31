import { verifyAdmin } from '@/lib/auth/admin'
import { getAllClassesWithWatchers } from '@/lib/db/admin-queries'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, Clock } from 'lucide-react'

/**
 * Admin Classes List Page
 *
 * Displays all classes being watched across the platform with:
 * - Class information (number, subject, title, instructor)
 * - Seat availability status
 * - Watcher count
 * - Last check timestamp
 *
 * Requires admin authentication via verifyAdmin().
 * Uses server-side data fetching for optimal performance.
 */
export default async function AdminClassesPage() {
  // Verify admin authentication (redirects if unauthorized)
  await verifyAdmin()

  // Fetch all classes with watcher counts
  const classes = await getAllClassesWithWatchers()

  /**
   * Format timestamp to relative time string
   */
  const formatRelativeTime = (timestamp: string): string => {
    const now = new Date()
    const then = new Date(timestamp)
    const diffMs = now.getTime() - then.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  /**
   * Get seat status badge variant based on availability
   */
  const getSeatBadgeVariant = (
    available: number,
    capacity: number
  ): 'success' | 'destructive' | 'warning' => {
    if (available === 0) return 'destructive'
    if (available / capacity < 0.2) return 'warning'
    return 'success'
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">All Classes</h1>
        <p className="text-muted-foreground">
          View all classes being monitored across the platform
        </p>
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Classes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{classes.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Watchers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {classes.reduce((sum, c) => sum + c.watcher_count, 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Full Classes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {classes.filter((c) => c.seats_available === 0).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Classes Table */}
      <Card>
        <CardHeader>
          <CardTitle>Classes Being Watched</CardTitle>
          <CardDescription>
            Click on a class number to view detailed information
          </CardDescription>
        </CardHeader>
        <CardContent>
          {classes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg font-medium mb-2">No classes found</p>
              <p className="text-sm">No classes are currently being watched by users</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Class #</TableHead>
                  <TableHead className="w-[120px]">Subject</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Instructor</TableHead>
                  <TableHead className="text-center w-[120px]">Seats</TableHead>
                  <TableHead className="text-center w-[100px]">
                    <div className="flex items-center justify-center gap-1">
                      <Users className="size-4" />
                      <span>Watchers</span>
                    </div>
                  </TableHead>
                  <TableHead className="text-right w-[120px]">
                    <div className="flex items-center justify-end gap-1">
                      <Clock className="size-4" />
                      <span>Last Check</span>
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classes.map((classItem) => (
                  <TableRow
                    key={classItem.id}
                    className="cursor-pointer"
                    onClick={() => {
                      window.location.href = `/admin/classes/${classItem.class_nbr}`
                    }}
                  >
                    <TableCell className="font-mono font-semibold">
                      <Link
                        href={`/admin/classes/${classItem.class_nbr}`}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {classItem.class_nbr}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{classItem.subject}</span>
                      <span className="text-muted-foreground ml-1">
                        {classItem.catalog_nbr}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[300px] truncate" title={classItem.title || ''}>
                        {classItem.title || '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[200px] truncate">
                        {classItem.instructor_name || 'Staff'}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={getSeatBadgeVariant(
                          classItem.seats_available,
                          classItem.seats_capacity
                        )}
                        size="sm"
                      >
                        {classItem.seats_available}/{classItem.seats_capacity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" size="sm">
                        {classItem.watcher_count}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatRelativeTime(classItem.last_checked_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
