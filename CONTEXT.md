# Domain Vocabulary

This document defines domain terms used throughout the codebase. New modules should use these terms consistently.

## Core Concepts

- **Class Section** — An ASU course section, identified by `class_nbr` (5-digit) + `term` (4-digit YYSM code, e.g. "2261" for Spring 2026). Each section is a single offering of a course with a specific instructor, schedule, and seat capacity. The class picker shows only the current and next selectable terms, driven by the ASU academic calendar in [`lib/asu/terms.ts`](./lib/asu/terms.ts). Extend that calendar each August when ASU publishes the next academic year.

- **Class Watch** — A user's subscription to monitor a Class Section for changes. Each watch belongs to one user and targets one section. Users are limited to `MAX_WATCHES_PER_USER` (default: 10).

- **Class State** — A cached snapshot of a Class Section's current data stored in the `class_states` table. Updated during each section check. Contains seats, instructor, location, and meeting times. Not authoritative — the ASU API is the source of truth.

## Notifications

- **Notification** — An email alert sent when a watched section changes. Two types: `seat_available` (seats opened up) and `instructor_assigned` (instructor changed from "Staff" to a named professor).

- **Notification Dedup** — Ensuring each watcher receives at most one notification per change type per cycle. Implemented atomically via the `try_record_notifications_batch` DB RPC, with stale-record cleanup and rollback on email failure.

- **Engagement** — Tracking of how many notification emails a user receives and opens. Used by the admin dashboard to identify healthy, low-engagement, and at-risk users.

## Processing Pipeline

- **Section Check** — One complete cycle of: fetch current state from DB → fetch latest data from ASU API → detect changes → send notifications → persist state. Each section check processes a single `class_nbr`.

- **Change Detection** — The algorithm that compares old and new section data to determine if seats became available, seats filled, or an instructor was assigned. Uses non-reserved seats (not total available) as the primary seat count signal.

- **Cron Cycle** — The every-30-minute scheduled job (`/api/cron`) that enqueues Section Checks. Partitioned by Stagger Group.

- **Stagger Group** — Even/odd class_nbr partitioning to spread checks across two cron triggers (:00 = even, :30 = odd). Reduces load on the ASU API.

- **Queue Message** — A `ClassCheckMessage` containing `class_nbr`, `term`, `enqueued_at`, and `stagger_group`. Sent to Cloudflare Queue for parallel processing.

## Architecture

- **Seam** — Where behaviour can be altered without editing in place (e.g., the `fetchClassFromASU()` function provides a seam at the ASU API boundary).
- **Adapter** — A concrete implementation satisfying an interface at a seam (e.g., `TtlCache` is an adapter around `Map` with expiry logic).
