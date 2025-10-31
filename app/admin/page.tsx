import { verifyAdmin } from '@/lib/auth/admin'
import {
  getTotalEmailsSent,
  getTotalUsers,
  getTotalClassesWatched,
} from '@/lib/db/admin-queries'
import { Header } from '@/components/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Mail, Users, Eye, Activity, TrendingUp, Clock } from 'lucide-react'

/**
 * Admin Dashboard Page
 *
 * Server Component that displays key platform metrics for admin users.
 * Protected by verifyAdmin() middleware - redirects non-admin users.
 *
 * Features:
 * - Total emails sent (notifications)
 * - Total registered users
 * - Total unique classes being watched
 * - Recent activity section (placeholder for future expansion)
 */
export default async function AdminDashboardPage() {
  // Verify admin access - redirects if not authenticated or not admin
  const adminUser = await verifyAdmin()

  // Fetch all statistics in parallel
  const [totalEmails, totalUsers, totalClasses] = await Promise.all([
    getTotalEmailsSent(),
    getTotalUsers(),
    getTotalClassesWatched(),
  ])

  // Calculate engagement metrics
  const avgWatchesPerUser = totalUsers > 0 ? (totalClasses / totalUsers).toFixed(1) : '0'
  const avgEmailsPerUser = totalUsers > 0 ? (totalEmails / totalUsers).toFixed(1) : '0'

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 sm:text-4xl">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Platform statistics and monitoring for {adminUser.email}
          </p>
        </div>

        {/* Primary Stats Grid */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Total Emails Sent */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Emails Sent
                </CardTitle>
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                  <Mail className="size-5 text-primary" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalEmails.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Notifications delivered to users
              </p>
            </CardContent>
          </Card>

          {/* Total Registered Users */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Registered Users
                </CardTitle>
                <div className="flex size-10 items-center justify-center rounded-full bg-success/10">
                  <Users className="size-5 text-success" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalUsers.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Active accounts on platform
              </p>
            </CardContent>
          </Card>

          {/* Total Classes Watched */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Classes Watched
                </CardTitle>
                <div className="flex size-10 items-center justify-center rounded-full bg-accent/10">
                  <Eye className="size-5 text-accent" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalClasses.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Unique sections monitored
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Engagement Metrics */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Engagement Metrics</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Average Watches Per User */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Avg Watches Per User
                  </CardTitle>
                  <TrendingUp className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{avgWatchesPerUser}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Classes monitored per account
                </p>
              </CardContent>
            </Card>

            {/* Average Emails Per User */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Avg Emails Per User
                  </CardTitle>
                  <Activity className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{avgEmailsPerUser}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Notifications sent per account
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Recent Activity Section - Placeholder */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                  <Clock className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base">Activity Feed Coming Soon</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Real-time monitoring and activity logs will be displayed here
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>Future features:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Recent user registrations</li>
                  <li>Latest email notifications sent</li>
                  <li>New class watches added</li>
                  <li>System health metrics</li>
                  <li>Scraper service status</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* System Info Footer */}
        <div className="text-xs text-muted-foreground text-center py-4 border-t border-border/40">
          <p>
            Admin dashboard for PickMyClass monitoring system. All times in UTC.
          </p>
        </div>
      </main>
    </div>
  )
}
