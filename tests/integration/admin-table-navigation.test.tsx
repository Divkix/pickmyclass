import { defaultParseSearch, defaultStringifySearch, useNavigate } from "@tanstack/react-router";
import type * as ReactRouter from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { z } from "zod";
import { classesSearchSchema } from "@/app/routes/admin/classes/index";
import { usersSearchSchema } from "@/app/routes/admin/users/index";
import { ClassesTable } from "@/components/admin/ClassesTable";
import { ClassesTableFiltersComponent } from "@/components/admin/ClassesTableFilters";
import { SortableHeader } from "@/components/admin/SortableHeader";
import { TablePagination } from "@/components/admin/TablePagination";
import { UsersTable } from "@/components/admin/UsersTable";
import { UsersTableFiltersComponent } from "@/components/admin/UsersTableFilters";

type AdminSearch = z.infer<typeof usersSearchSchema> | z.infer<typeof classesSearchSchema>;

// Exercise the tables' actual callbacks and route schemas without a DOM or server transport.
const { navigate } = vi.hoisted(() => ({
  navigate: vi
    .fn<(options: { search?: (previous: AdminSearch) => AdminSearch }) => Promise<void>>()
    .mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: vi.fn(() => navigate),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ validator: () => ({ handler: () => vi.fn() }) }),
}));

vi.mock("@/lib/auth/admin", () => ({ verifyAdmin: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDbFromEnv: vi.fn() }));

vi.mock("@/lib/db/admin-queries", () => ({
  getUsersPage: vi.fn(),
  getClassesPage: vi.fn(),
  getDistinctSubjects: vi.fn(),
}));

vi.mock("@/components/admin/UsersTableFilters", () => ({
  UsersTableFiltersComponent: vi.fn(() => null),
}));

vi.mock("@/components/admin/ClassesTableFilters", () => ({
  ClassesTableFiltersComponent: vi.fn(() => null),
}));

vi.mock("@/components/admin/SortableHeader", () => ({ SortableHeader: vi.fn(() => null) }));

vi.mock("@/components/admin/TablePagination", () => ({ TablePagination: vi.fn(() => null) }));

function renderTable(kind: "users" | "classes", dir: "asc" | "desc" = "desc") {
  if (kind === "users") {
    const role = "all";
    renderToStaticMarkup(
      <UsersTable
        users={[]}
        total={75}
        page={3}
        pageSize={25}
        sort="created_at"
        dir={dir}
        search="prior"
        role={role}
        verified="all"
        watchCount="all"
      />,
    );
  } else {
    renderToStaticMarkup(
      <ClassesTable
        classes={[]}
        total={75}
        page={3}
        pageSize={25}
        subjects={["CSE"]}
        sort="watcher_count"
        dir={dir}
        search="prior"
        subject="all"
        seatStatus="all"
        instructor="all"
        watcherCount="all"
      />,
    );
  }

  const changeFilters =
    kind === "users"
      ? vi.mocked(UsersTableFiltersComponent).mock.calls.at(-1)?.[0].onNavigate
      : vi.mocked(ClassesTableFiltersComponent).mock.calls.at(-1)?.[0].onNavigate;

  const schema = kind === "users" ? usersSearchSchema : classesSearchSchema;

  if (!changeFilters) throw new Error("Admin table is missing its search contract");

  return { changeFilters, schema };
}

function applyNavigation(previous: AdminSearch) {
  const options = navigate.mock.calls.at(-1)?.[0];
  expect(options).not.toHaveProperty("href");

  if (!options?.search) throw new Error("Table navigation must use a typed search updater");

  return options.search(previous);
}

describe.each(["users", "classes"] as const)("admin %s table search", (kind) => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["1.50", '"bob"', "[1]", "true", "null", "all", ""])(
    "round-trips the literal search text %j and resets pagination",
    (search) => {
      const { changeFilters, schema } = renderTable(kind);
      const previous = schema.parse({ search: "prior", page: 3, role: "admin", subject: "CSE" });

      changeFilters({ search });
      const next = applyNavigation(previous);

      expect(useNavigate).toHaveBeenCalledWith({ from: `/admin/${kind}/` });
      expect(next).toEqual({ ...previous, search, page: 1 });
      expect(schema.parse(defaultParseSearch(defaultStringifySearch(next))).search).toBe(search);
    },
  );

  it.each(["asc", "desc"] as const)("toggles %s sorting and resets only the page", (dir) => {
    const { schema } = renderTable(kind, dir);
    const previous = schema.parse({ page: 3, search: "1.50", dir });
    const header = vi.mocked(SortableHeader).mock.calls[0]?.[0];

    if (!header) throw new Error("Admin table is missing its sortable headers");

    header.toggleSort(previous.sort);
    expect(applyNavigation(previous)).toEqual({
      ...previous,
      dir: dir === "asc" ? "desc" : "asc",
      page: 1,
    });

    header.toggleSort(header.field);
    expect(applyNavigation(previous)).toEqual({
      ...previous,
      sort: header.field,
      dir: "asc",
      page: 1,
    });
  });

  it("changes pages without resetting filters or sort", () => {
    const { schema } = renderTable(kind);
    const previous = schema.parse({ page: 3, search: '"bob"', role: "admin", subject: "CSE" });
    const pagination = vi.mocked(TablePagination).mock.calls.at(-1)?.[0];

    if (!pagination) throw new Error("Admin table is missing its pagination controls");

    pagination.onNavigate({ page: 2 });
    expect(applyNavigation(previous)).toEqual({ ...previous, page: 2 });
  });

  it("keeps defaults for malformed search parameters", () => {
    const { schema } = renderTable(kind);

    expect(schema.parse({ page: [], search: [1], sort: "invalid", dir: "invalid" })).toMatchObject({
      page: 1,
      search: "",
      dir: "desc",
    });
  });
});
