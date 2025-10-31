'use client'

import { useRouter } from 'next/navigation'
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
import { Users, Clock } from 'lucide-react'
import type { ClassWithWatchers } from '@/lib/db/admin-queries'

interface ClassesTableProps {
  classes: ClassWithWatchers[]
}

/**
 * Format timestamp to relative time string
 */
function formatRelativeTime(timestamp: string): string {
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
function getSeatBadgeVariant(
  available: number,
  capacity: number
): 'success' | 'destructive' | 'warning' {
  if (available === 0) return 'destructive'
  if (available / capacity < 0.2) return 'warning'
  return 'success'
}

/**
 * Admin Classes Table Component
 *
 * Client Component that renders a table of all classes being watched.
 * Handles row click navigation to class detail pages.
 *
 * @param classes - Array of classes with watcher counts
 */
export function ClassesTable({ classes }: ClassesTableProps) {
  const router = useRouter()

  if (classes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium mb-2">No classes found</p>
        <p className="text-sm">No classes are currently being watched by users</p>
      </div>
    )
  }

  return (
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
              router.push(`/admin/classes/${classItem.class_nbr}`)
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
              <span className="text-muted-foreground ml-1">{classItem.catalog_nbr}</span>
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
  )
}
