import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { Suspense } from "react";
import { UsersTable } from "@/components/admin/UsersTable";
import { verifyAdmin } from "@/lib/auth/admin";
import { getUsersPage } from "@/lib/db/admin-queries";
import { getDbFromEnv } from "@/lib/db";
import { parsePageParam } from "@/lib/utils/page-params";

const PAGE_SIZE = 25;

const usersSearchSchema = z.object({
  page: z
    .union([z.string(), z.number()])
    .default("")
    .catch("")
    .transform((value) => parsePageParam(String(value))),
  sort: z
    .enum([
      "email",
      "created_at",
      "last_sign_in_at",
      "watch_count",
      "seat_emails",
      "instructor_emails",
    ])
    .default("created_at")
    .catch("created_at"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  search: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .default("")
    .catch("")
    .transform(String),
  role: z.enum(["all", "admin", "user"]).default("all").catch("all"),
  verified: z.enum(["all", "verified", "unverified"]).default("all").catch("all"),
  watchCount: z.enum(["all", "none", "1-5", "6-10", "10+"]).default("all").catch("all"),
});

const loadAdminUsers = createServerFn()
  .validator(usersSearchSchema)
  .handler(async ({ data }) => {
    await verifyAdmin("/admin/users");

    const result = await getUsersPage(getDbFromEnv(), { ...data, pageSize: PAGE_SIZE });

    return { ...result, ...data };
  });

export const Route = createFileRoute("/admin/users/")({
  validateSearch: usersSearchSchema,
  search: { middlewares: [stripSearchParams(usersSearchSchema.parse({}))] },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadAdminUsers({ data: deps }),
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const { rows, total, page, sort, dir, search, role, verified, watchCount } =
    Route.useLoaderData();

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-foreground mb-2">Users</h1>
        <p className="text-muted-foreground">
          Total registered users: <span className="font-semibold">{total}</span>
        </p>
      </div>

      <Suspense fallback={null}>
        <UsersTable
          users={rows}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          sort={sort}
          dir={dir}
          search={search}
          role={role}
          verified={verified}
          watchCount={watchCount}
        />
      </Suspense>

      {rows.length > 0 && (
        <div className="mt-4 text-sm text-muted-foreground">
          Click on a user email to view detailed information
        </div>
      )}
    </div>
  );
}
