import { verifyAdmin } from '@/lib/auth/admin'
import { getAllClassesWithWatchers } from '@/lib/db/admin-queries'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ClassesTable } from '@/components/admin/ClassesTable'

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
          <ClassesTable classes={classes} />
        </CardContent>
      </Card>
    </div>
  )
}
