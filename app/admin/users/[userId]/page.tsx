import { ArrowLeft, Calendar, Clock, Eye, Mail, Shield } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { verifyAdmin } from '@/lib/auth/admin';
import { getUserWatches } from '@/lib/db/admin-queries';
import { getServiceClient } from '@/lib/supabase/service';

interface AdminUserDetailPageProps {
  params: Promise<{
    userId: string;
  }>;
}

/**
 * Admin User Detail Page
 *
 * Displays detailed information about a specific user including:
 * - User profile information (email, registration date, verification status)
 * - All class watches for this user
 * - Quick navigation back to users list
 *
 * Requires admin authentication via verifyAdmin().
 * Uses server-side data fetching for optimal performance.
 */
export default async function AdminUserDetailPage({ params }: AdminUserDetailPageProps) {
  // Verify admin authentication (redirects if unauthorized)
  await verifyAdmin();

  // Await params in Next.js 15
  const { userId } = await params;

  // Create service client for auth.users access
  const supabase = getServiceClient();

  // Fetch user information from auth.users
  const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);

  if (authError || !authData?.user) {
    console.error(`[Admin] User ${userId} not found:`, authError);
    notFound();
  }

  const user = authData.user;

  // Fetch user's class watches
  const watches = await getUserWatches(userId);

  /**
   * Format ISO timestamp to readable date string
   */
  const formatDate = (timestamp: string | null | undefined): string => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /**
   * Get seat status badge variant based on availability
   */
  const getSeatBadgeVariant = (
    available: number,
    capacity: number
  ): 'success' | 'destructive' | 'warning' => {
    if (available === 0) return 'destructive';
    if (available / capacity < 0.2) return 'warning';
    return 'success';
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Breadcrumb Navigation */}
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin" className="hover:text-foreground transition-colors">
          Admin
        </Link>
        <span>/</span>
        <Link href="/admin/users" className="hover:text-foreground transition-colors">
          Users
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{user.email}</span>
      </div>

      {/* Page Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">User Details</h1>
          <p className="text-muted-foreground">
            View detailed information and class watches for this user
          </p>
        </div>
        <Link href="/admin/users">
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft className="size-4" />
            Back to Users
          </Button>
        </Link>
      </div>

      {/* User Information Card */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>User Information</CardTitle>
          <CardDescription>Account details and authentication status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Email */}
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 shrink-0">
                <Mail className="size-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground mb-1">Email Address</p>
                <p className="font-medium truncate">{user.email || 'No email'}</p>
              </div>
            </div>

            {/* Email Verified */}
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-success/10 shrink-0">
                <Shield className="size-5 text-success" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Email Verification</p>
                <div className="flex items-center gap-2">
                  {user.email_confirmed_at ? (
                    <>
                      <Badge variant="success" size="sm">
                        Verified
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(user.email_confirmed_at)}
                      </span>
                    </>
                  ) : (
                    <Badge variant="warning" size="sm">
                      Not Verified
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Registration Date */}
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-accent/10 shrink-0">
                <Calendar className="size-5 text-accent" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Registration Date</p>
                <p className="font-medium">{formatDate(user.created_at)}</p>
              </div>
            </div>

            {/* Last Sign In */}
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted shrink-0">
                <Clock className="size-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Last Sign In</p>
                <p className="font-medium">{formatDate(user.last_sign_in_at)}</p>
              </div>
            </div>

            {/* User ID */}
            <div className="flex items-start gap-3 md:col-span-2">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted shrink-0">
                <Eye className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground mb-1">User ID</p>
                <p className="font-mono text-sm break-all">{user.id}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Class Watches Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Class Watches</CardTitle>
              <CardDescription>All classes this user is currently monitoring</CardDescription>
            </div>
            <Badge variant="outline" size="lg">
              {watches.length} {watches.length === 1 ? 'watch' : 'watches'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {watches.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg font-medium mb-2">No class watches</p>
              <p className="text-sm">This user is not currently watching any classes</p>
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
                  <TableHead className="text-right w-[140px]">Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {watches.map((watch) => {
                  const classState = watch.class_state;
                  return (
                    <TableRow key={watch.id}>
                      <TableCell className="font-mono font-semibold">
                        <Link
                          href={`/admin/classes/${watch.class_nbr}`}
                          className="text-primary hover:underline"
                        >
                          {watch.class_nbr}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{watch.subject}</span>
                        <span className="text-muted-foreground ml-1">{watch.catalog_nbr}</span>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[300px] truncate" title={classState?.title || ''}>
                          {classState?.title || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[200px] truncate">
                          {classState?.instructor_name || 'Staff'}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {classState ? (
                          <Badge
                            variant={getSeatBadgeVariant(
                              classState.seats_available,
                              classState.seats_capacity
                            )}
                            size="sm"
                          >
                            {classState.seats_available}/{classState.seats_capacity}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {new Date(watch.created_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
