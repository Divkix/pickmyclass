import { ArrowLeft, BookOpen, Calendar, Clock, MapPin, Users } from 'lucide-react';
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
import { getClassWatchers } from '@/lib/db/queries';
import { getServiceClient } from '@/lib/supabase/service';

interface AdminClassDetailPageProps {
  params: Promise<{
    classNbr: string;
  }>;
}

/**
 * Admin Class Detail Page
 *
 * Displays detailed information about a specific class section including:
 * - Class information (number, subject, title, instructor, seats, location, times)
 * - List of users watching this class with their details
 * - Last checked/changed timestamps
 *
 * Requires admin authentication via verifyAdmin().
 * Uses dynamic route parameter [classNbr] to fetch class data.
 */
export default async function AdminClassDetailPage({ params }: AdminClassDetailPageProps) {
  // Verify admin authentication (redirects if unauthorized)
  await verifyAdmin();

  // Resolve params promise
  const { classNbr } = await params;

  // Fetch class state from database
  const supabase = getServiceClient();
  const { data: classState, error: classError } = await supabase
    .from('class_states')
    .select('*')
    .eq('class_nbr', classNbr)
    .single();

  // Handle case where class not found
  if (classError || !classState) {
    notFound();
  }

  // Fetch watchers for this class
  const watchers = await getClassWatchers(classNbr);

  /**
   * Format timestamp to readable date/time string
   */
  const formatDateTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /**
   * Format timestamp to relative time string
   */
  const formatRelativeTime = (timestamp: string): string => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
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
      <div className="mb-6">
        <Link href="/admin/classes">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="size-4" />
            Back to All Classes
          </Button>
        </Link>
      </div>

      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              {classState.subject} {classState.catalog_nbr}
            </h1>
            <p className="text-muted-foreground text-lg">{classState.title || 'No title'}</p>
          </div>
          <Badge
            variant={getSeatBadgeVariant(classState.seats_available, classState.seats_capacity)}
            className="text-base px-3 py-1"
          >
            {classState.seats_available}/{classState.seats_capacity} seats
          </Badge>
        </div>
      </div>

      {/* Class Information Card */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Class Information</CardTitle>
          <CardDescription>Current status and details for this class section</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Left Column */}
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Section Number</div>
                <div className="font-mono text-lg font-semibold">{classState.class_nbr}</div>
              </div>

              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Course Code</div>
                <div className="text-lg">
                  {classState.subject} {classState.catalog_nbr}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Term</div>
                <div className="text-lg">{classState.term}</div>
              </div>

              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Instructor</div>
                <div className="text-lg">{classState.instructor_name || 'Staff'}</div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                  <BookOpen className="size-4" />
                  Seat Availability
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-lg">
                    <span>Available:</span>
                    <span className="font-semibold">{classState.seats_available}</span>
                  </div>
                  <div className="flex items-center justify-between text-lg">
                    <span>Capacity:</span>
                    <span className="font-semibold">{classState.seats_capacity}</span>
                  </div>
                  {classState.non_reserved_seats !== null && (
                    <div className="flex items-center justify-between text-lg">
                      <span>Non-Reserved:</span>
                      <span className="font-semibold">{classState.non_reserved_seats}</span>
                    </div>
                  )}
                </div>
              </div>

              {classState.location && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                    <MapPin className="size-4" />
                    Location
                  </div>
                  <div className="text-lg">{classState.location}</div>
                </div>
              )}

              {classState.meeting_times && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                    <Calendar className="size-4" />
                    Meeting Times
                  </div>
                  <div className="text-lg">{classState.meeting_times}</div>
                </div>
              )}
            </div>
          </div>

          {/* Timestamps */}
          <div className="border-t mt-6 pt-6 grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                <Clock className="size-4" />
                Last Checked
              </div>
              <div className="text-lg">
                {formatDateTime(classState.last_checked_at)}
                <span className="text-sm text-muted-foreground ml-2">
                  ({formatRelativeTime(classState.last_checked_at)})
                </span>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                <Clock className="size-4" />
                Last Changed
              </div>
              <div className="text-lg">
                {formatDateTime(classState.last_changed_at)}
                <span className="text-sm text-muted-foreground ml-2">
                  ({formatRelativeTime(classState.last_changed_at)})
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Watchers Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" />
            Watchers ({watchers.length})
          </CardTitle>
          <CardDescription>
            Users who are currently watching this class for notifications
          </CardDescription>
        </CardHeader>
        <CardContent>
          {watchers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg font-medium mb-2">No watchers</p>
              <p className="text-sm">No users are currently watching this class</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead className="text-right">Date Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {watchers.map((watcher) => (
                  <TableRow key={watcher.watch_id}>
                    <TableCell>
                      <Link
                        href={`/admin/users/${watcher.user_id}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {watcher.email}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground">{watcher.user_id}</code>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {watcher.created_at ? formatDateTime(watcher.created_at) : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
