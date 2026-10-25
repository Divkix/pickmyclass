import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { Suspense } from "react";
import { ClassesTable } from "@/components/admin/ClassesTable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifyAdmin } from "@/lib/auth/admin";
import { getClassesPage, getDistinctSubjects } from "@/lib/db/admin-queries";
import { getDbFromEnv } from "@/lib/db";
import { parsePageParam } from "@/lib/utils/page-params";

const PAGE_SIZE = 25;

const classesSearchSchema = z.object({
  page: z
    .union([z.string(), z.number()])
    .default("")
    .catch("")
    .transform((value) => parsePageParam(String(value))),
  sort: z
    .enum([
      "class_nbr",
      "subject",
      "seats_available",
      "watcher_count",
      "seat_emails",
      "instructor_emails",
      "last_checked_at",
    ])
    .default("watcher_count")
    .catch("watcher_count"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  search: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .default("")
    .catch("")
    .transform(String),
  subject: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .default("all")
    .catch("all")
    .transform((value) => String(value) || "all"),
  seatStatus: z.enum(["all", "full", "limited", "available"]).default("all").catch("all"),
  instructor: z.enum(["all", "staff", "named"]).default("all").catch("all"),
  watcherCount: z.enum(["all", "none", "1-5", "6-10", "10+"]).default("all").catch("all"),
});

const loadAdminClasses = createServerFn()
  .validator(classesSearchSchema)
  .handler(async ({ data }) => {
    await verifyAdmin("/admin/classes");
    const db = getDbFromEnv();

    const [result, subjects] = await Promise.all([
      getClassesPage(db, { ...data, pageSize: PAGE_SIZE }),
      getDistinctSubjects(db),
    ]);

    return { ...result, subjects, ...data };
  });

export const Route = createFileRoute("/admin/classes/")({
  validateSearch: classesSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadAdminClasses({ data: deps }),
  component: AdminClassesPage,
});

function AdminClassesPage() {
  const {
    rows,
    total,
    totalWatchers,
    fullClasses,
    subjects,
    page,
    sort,
    dir,
    search,
    subject,
    seatStatus,
    instructor,
    watcherCount,
  } = Route.useLoaderData();

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold mb-2">All Classes</h1>
        <p className="text-muted-foreground">
          View all classes being monitored across the platform
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sections Tracked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Includes sections with no current watchers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Watchers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalWatchers}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Full Classes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{fullClasses}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Classes Being Watched</CardTitle>
          <CardDescription>Click on a class number to view detailed information</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <ClassesTable
              classes={rows}
              total={total}
              page={page}
              pageSize={PAGE_SIZE}
              subjects={subjects}
              sort={sort}
              dir={dir}
              search={search}
              subject={subject}
              seatStatus={seatStatus}
              instructor={instructor}
              watcherCount={watcherCount}
            />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
