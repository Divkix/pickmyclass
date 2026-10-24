import { vi } from "vite-plus/test";
import type { ClassDetails } from "@/lib/types/class";

export const ref = { class_nbr: "12345", term: "2267", cycle: "2026-10-15T12:00:00.000Z" };

export const details: ClassDetails = {
  subject: "CSE",
  catalog_nbr: "110",
  title: "Programming",
  instructor_name: "Staff",
  seats_available: 2,
  seats_capacity: 30,
  non_reserved_seats: 2,
  location: "BYAC",
  meeting_times: "TBD",
  start_date: null,
  end_date: null,
  session_code: null,
};

export function state(seats = 0, instructor = "Staff") {
  return {
    class_nbr: ref.class_nbr,
    term: ref.term,
    seats_available: seats,
    non_reserved_seats: seats,
    instructor_name: instructor,
    consecutive_not_found_count: 0,
    last_checked_at: "2026-10-15T11:00:00.000Z",
    has_pending_intent: false,
  };
}

export function environment() {
  const send = vi.fn().mockResolvedValue({ messageId: "message-1" });
  // SAFETY: these tests exercise only the Email binding's send method.
  const EMAIL = { send } as SendEmail;

  return {
    ASU_API_BASE_URL: "https://asu.test",
    ASU_API_TOKEN: "test-token",
    EMAIL,
    NOTIFICATION_FROM_EMAIL: "sender@test.com",
    send,
  };
}

export const watcher = { user_id: "user-1", email: "student@test.com", watch_id: "watch-1" };

export const claim = { notification_id: "claim-1", class_watch_id: watcher.watch_id };

export const changes = {
  seatBecameAvailable: true,
  seatsFilled: false,
  instructorAssigned: false,
  newOpenSeats: 2,
};

/** A pending_section_notifications row for `ref`, unleased. */
export const pending = {
  id: "intent-1",
  class_nbr: ref.class_nbr,
  term: ref.term,
  class_info: { ...details, ...ref },
  changes: { ...changes },
  expires_at: "2026-10-15T15:00:00.000Z",
  lease_id: null,
  leased_until: null,
};
