export const dynamic = 'force-dynamic';

import { Activity, Eye, Mail, TrendingUp, Users } from 'lucide-react';
import { RecentActivity } from '@/components/admin/RecentActivity';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { verifyAdmin } from '@/lib/auth/admin';
import {
  getAdminCount,
  getRecentActivity,
  getTotalClassesWatched,
  getTotalEmailsSent,
  getTotalUsers,
} from '@/lib/db/admin-queries';
import { getDbFromEnv } from '@/lib/db';

export default async function AdminDashboardPage() {
  const db = getDbFromEnv();

  const adminUser = await verifyAdmin(db);

  const [totalEmails, totalUsers, totalClasses, adminCount, recentActivity] = await Promise.all([
    getTotalEmailsSent(db),
    getTotalUsers(db),
    getTotalClassesWatched(db),
    getAdminCount(db),
    getRecentActivity(db, 10),
  ]);

  const avgWatchesPerUser = totalUsers > 0 ? (totalClasses / totalUsers).toFixed(1) : '0';
  const avgEmailsPerUser = totalUsers > 0 ? (totalEmails / totalUsers).toFixed(1) : '0';

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold mb-2 sm:text-4xl">Admin Dashboard</h1>
        <p className="text-muted-foreground">
          Platform statistics and monitoring for {adminUser.email}
        </p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <p className="text-xs text-muted-foreground mt-1">Notifications delivered to users</p>
          </CardContent>
        </Card>

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
            <div className="text-3xl font-bold">
              {totalUsers.toLocaleString()}
              {adminCount > 0 && (
                <span className="text-base font-normal text-muted-foreground ml-2">
                  ({adminCount} admin{adminCount !== 1 ? 's' : ''})
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Total user accounts (including admins)
            </p>
          </CardContent>
        </Card>

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
            <p className="text-xs text-muted-foreground mt-1">Unique sections monitored</p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Engagement Metrics</h2>
        <div className="grid gap-4 sm:grid-cols-2">
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
              <p className="text-xs text-muted-foreground mt-1">Classes monitored per account</p>
            </CardContent>
          </Card>

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
              <p className="text-xs text-muted-foreground mt-1">Notifications sent per account</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mb-8">
        <RecentActivity items={recentActivity} />
      </div>

      <div className="text-xs text-muted-foreground text-center py-4 border-t border-border/40">
        <p>
          Admin dashboard for PickMyClass monitoring system. Times shown in your local timezone.
        </p>
      </div>
    </div>
  );
}
