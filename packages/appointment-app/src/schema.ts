import { Vennbase, RowHandle, collection, defineSchema, field, type DbQueryRow, type InsertFields, type RowRef } from "@vennbase/core";

export const schema = defineSchema({
  schedules: collection({
    fields: {
      title: field.string(),
      timezone: field.string(),
      slotDurationMinutes: field.number(),
      bookingSubmitterLink: field.string(),
      mondayStart: field.string().optional(),
      mondayEnd: field.string().optional(),
      tuesdayStart: field.string().optional(),
      tuesdayEnd: field.string().optional(),
      wednesdayStart: field.string().optional(),
      wednesdayEnd: field.string().optional(),
      thursdayStart: field.string().optional(),
      thursdayEnd: field.string().optional(),
      fridayStart: field.string().optional(),
      fridayEnd: field.string().optional(),
      saturdayStart: field.string().optional(),
      saturdayEnd: field.string().optional(),
      sundayStart: field.string().optional(),
      sundayEnd: field.string().optional(),
    },
  }),
  bookingRoots: collection({
    fields: {
      createdAt: field.number().indexKey(),
    },
  }),
  scheduleUsers: collection({
    in: ["schedules", "user"],
    fields: {
      scheduleRef: field.ref("schedules").indexKey(),
      createdAt: field.number().indexKey(),
    },
  }),
  bookings: collection({
    in: ["bookingRoots", "scheduleUsers"],
    fields: {
      slotStartMs: field.number().indexKey(),
      slotEndMs: field.number().indexKey(),
      claimedAtMs: field.number().indexKey(),
      scheduleUserRef: field.ref("scheduleUsers"),
      customerUsername: field.string(),
    },
  }),
  recentSchedules: collection({
    in: ["user"],
    fields: {
      scheduleRef: field.ref("schedules").indexKey(),
      openedAt: field.number().indexKey(),
    },
  }),
});

export type Schema = typeof schema;
export type AppointmentDb = Vennbase<Schema>;
export type ScheduleHandle = RowHandle<Schema, "schedules">;
export type BookingRootHandle = RowHandle<Schema, "bookingRoots">;
export type ScheduleUserHandle = RowHandle<Schema, "scheduleUsers">;
export type BookingHandle = RowHandle<Schema, "bookings">;
export type RecentScheduleHandle = RowHandle<Schema, "recentSchedules">;
export type BookingIndexKeyProjection = DbQueryRow<Schema, "bookings", "indexKeys">;
export type BookingRootRef = RowRef<"bookingRoots">;
export type ScheduleUserRef = RowRef<"scheduleUsers">;
export type ScheduleInsertFields = InsertFields<Schema, "schedules">;
export type EditableScheduleFields = Omit<ScheduleInsertFields, "bookingSubmitterLink">;
