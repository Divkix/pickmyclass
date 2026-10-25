"use client";

import { ChevronDown, ChevronUp, ChevronsUpDown, Clock, Mail, Users } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ClassSortField } from "@/lib/db/admin-queries";
import type { ClassWithWatchers } from "@/lib/db/admin-queries";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useTableNavigate } from "@/lib/hooks/useTableNavigate";
import { getSeatBadgeVariant } from "@/lib/utils/seat-badge";
import { formatAbsoluteDate, formatRelativeTime } from "@/lib/utils/time-format";
import { SortableHeader } from "./SortableHeader";
import { ClassesTableFiltersComponent } from "./ClassesTableFilters";
import { TablePagination } from "./TablePagination";

interface ClassesTableProps {
  classes: ClassWithWatchers[];
  total: number;
  page: number;
  pageSize: number;
  subjects: string[];
  sort: ClassSortField;
  dir: "asc" | "desc";
  search: string;
  subject: string;
  seatStatus: "all" | "full" | "limited" | "available";
  instructor: "all" | "staff" | "named";
  watcherCount: "all" | "none" | "1-5" | "6-10" | "10+";
}

export function ClassesTable({
  classes,
  total,
  page,
  pageSize,
  subjects,
  sort,
  dir,
  search,
  subject,
  seatStatus,
  instructor,
  watcherCount,
}: ClassesTableProps) {
  const navigateTo = useNavigate();
  const navigate = useTableNavigate();
  const mounted = useHydrated();

  const handleSortClick = (field: ClassSortField) => {
    if (sort === field) {
      navigate({ sort: field, dir: dir === "asc" ? "desc" : "asc", page: "1" });
    } else {
      navigate({ sort: field, dir: "asc", page: "1" });
    }
  };

  const renderSortIconFromUrl = (field: ClassSortField) => {
    if (sort !== field) return <ChevronsUpDown className="size-4 ml-1 text-muted-foreground" />;

    if (dir === "asc") return <ChevronUp className="size-4 ml-1" />;

    return <ChevronDown className="size-4 ml-1" />;
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (
    total === 0 &&
    search === "" &&
    subject === "all" &&
    seatStatus === "all" &&
    instructor === "all" &&
    watcherCount === "all"
  ) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium mb-2">No classes found</p>
        <p className="text-sm">No classes are currently being watched by users</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ClassesTableFiltersComponent
        subjects={subjects}
        search={search}
        subject={subject}
        seatStatus={seatStatus}
        instructor={instructor}
        watcherCount={watcherCount}
        onNavigate={(updates) => navigate({ ...updates, page: "1" })}
      />

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader
                field="class_nbr"
                label="Class #"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="left"
                className="w-[100px]"
              />
              <SortableHeader
                field="subject"
                label="Subject"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="left"
                className="w-[120px]"
              />
              <TableHead>Title</TableHead>
              <TableHead>Instructor</TableHead>
              <SortableHeader
                field="seats_available"
                label="Seats"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center w-[120px]"
              />
              <SortableHeader
                field="watcher_count"
                label="Watchers"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center w-[100px]"
              >
                <Users className="size-4" />
              </SortableHeader>
              <SortableHeader
                field="seat_emails"
                label="Seat Emails"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center w-[100px]"
              >
                <Mail className="size-4" />
              </SortableHeader>
              <SortableHeader
                field="instructor_emails"
                label="Instructor Emails"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center w-[100px]"
              >
                <Users className="size-4" />
              </SortableHeader>
              <SortableHeader
                field="last_checked_at"
                label="Last Check"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="right"
                className="text-right w-[120px]"
              >
                <Clock className="size-4" />
              </SortableHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {classes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No classes match the selected filters
                </TableCell>
              </TableRow>
            ) : (
              classes.map((classItem) => (
                <TableRow
                  key={classItem.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => {
                    void navigateTo({
                      to: "/admin/classes/$term/$classNbr",
                      params: { term: classItem.term, classNbr: classItem.class_nbr },
                    });
                  }}
                >
                  <TableCell className="font-mono font-semibold">
                    <Link
                      to="/admin/classes/$term/$classNbr"
                      params={{ term: classItem.term, classNbr: classItem.class_nbr }}
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
                    <div className="max-w-[300px] truncate" title={classItem.title || ""}>
                      {classItem.title || "-"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[200px] truncate">
                      {classItem.instructor_name || "Staff"}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={getSeatBadgeVariant(
                        classItem.seats_available,
                        classItem.seats_capacity,
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
                  <TableCell className="text-center">
                    <Badge variant="outline" size="sm">
                      {classItem.seat_emails}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" size="sm">
                      {classItem.instructor_emails}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {mounted
                      ? formatRelativeTime(classItem.last_checked_at)
                      : formatAbsoluteDate(classItem.last_checked_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        emptyMessage="No classes match the selected filters"
        itemNoun="classes"
        onNavigate={navigate}
      />
    </div>
  );
}
