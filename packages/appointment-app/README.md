# appointment-app — Advanced patterns

This app is a scheduling tool: an owner publishes available time slots and customers self-book. It is deliberately minimal so three access-control patterns stay visible.

Run it with:

```bash
pnpm --filter appointment-app dev
```

The schema lives in `src/schema.ts`. The service layer lives in `src/service.ts`.

---

## Pattern 1: Blind booking inbox

**Problem.** Customers need to create bookings under a parent row that only the owner can read. The owner doesn't want to send each customer a separate invite.

**Trick.** Store the submitter link for the hidden `bookingRoots` row as a plain string field on the *readable* `schedules` row. Any viewer of the schedule calls `joinInvite(...)` on that embedded link to gain submitter access to the inbox — without ever getting readable access to it.

**Owner side — create the inbox and embed its link in the schedule** (`src/service.ts`):

```ts
const bookingRootWrite = this.db.create("bookingRoots", { createdAt: Date.now() });
const bookingRoot = bookingRootWrite.value;
await bookingRootWrite.committed;

const bookingSubmitterLink = await this.db.createSubmissionLink(bookingRoot.ref).committed;
this.db.create("schedules", {
  ...draftToScheduleFields(draft),
  bookingSubmitterLink,  // stored as a plain string field on the readable row
});
```

**Customer side — claim submitter access from the embedded link** (`src/service.ts`):

```ts
async ensureBookingRootAccess(schedule: ScheduleHandle): Promise<BookingRootRef> {
  const joined = await this.db.joinInvite(schedule.fields.bookingSubmitterLink);
  return joined.ref as BookingRootRef;
}
```

`joinInvite` is idempotent — calling it again on a link the user already joined is a no-op. Call it every time a customer opens a schedule; no local state needed.

The customer never holds a viewer link to `bookingRoots` itself, so they cannot read the parent row, inspect its members, or see other customers' full booking records.

---

## Pattern 2: Anonymized sibling visibility with `select: "keys"`

**Problem.** Customers need to see which slots are already taken so they can pick an open one — but they shouldn't see other customers' private booking details.

**Trick.** Query with `select: "keys"`. Submitters can run this query against the inbox without needing read access to the parent. The response includes only fields declared `.key()` in the schema.

**In the UI** (`src/App.tsx` — `CustomerScheduleView`):

```ts
const { rows: sharedBookings = [] } = useQuery(db, "bookings", {
  in: props.bookingRootRef,
  select: "keys",
  limit: 500,
});
```

**Imperatively before writing**, to detect a double-booking race (`src/service.ts`):

```ts
const existing = await this.db.query("bookings", {
  in: args.bookingRootRef,
  select: "keys",
  limit: 500,
});
if (existing.some((b) => b.fields.slotStartMs === args.slotStartMs && b.fields.slotEndMs === args.slotEndMs)) {
  throw new Error("This slot is no longer available.");
}
```

`select: "keys"` works in both `useQuery` and the imperative `db.query`. No additional permissions are required — submitter access already allows key-only sibling queries.

---

## Pattern 3: Minimal key fields

`select: "keys"` only exposes fields declared `.key()`. The `bookings` schema is designed so key-only results contain just enough to render an occupied-slots calendar — nothing more:

```ts
// src/schema.ts
bookings: collection({
  in: ["bookingRoots"],
  fields: {
    slotStartMs: field.number().key(),  // exposed by select: "keys"
    slotEndMs:   field.number().key(),  // exposed by select: "keys"
    createdAt:   field.number(),        // NOT a key — hidden from submitters
  },
}),
```

**Design rule:** before marking a field `.key()`, ask whether it is safe for submitters to read. If not, leave `.key()` off and it will never appear in key-only queries, regardless of what is added to the schema later.

---

## How the three patterns compose

The app wires all three together into a single access-control surface the owner never has to touch again:

1. **Owner creates a schedule.** During creation, a hidden `bookingRoots` row is created and its submitter link is stored in `schedule.fields.bookingSubmitterLink`.
2. **Owner shares the schedule** using a viewer share link. Customers open it.
3. **Customer joins the inbox** — Pattern 1. `ensureBookingRootAccess` calls `joinInvite` on the embedded link, returning a `BookingRootRef` with submitter access.
4. **Customer queries occupied slots** — Patterns 2 and 3. `select: "keys"` returns `{ slotStartMs, slotEndMs }` from sibling bookings. `createdAt` and any future private fields are invisible.
5. **Customer creates a booking** under the `BookingRootRef`. Only the owner (with full access) can read the complete booking records.

The owner never manually grants or revokes customer access. The submitter link embedded in the schedule is the entire access-control surface.
