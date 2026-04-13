# Advanced patterns — appointment-app

The `packages/appointment-app` example demonstrates three access-control patterns for booking and claiming shared resources. This is a recipe-style walkthrough of each.

Run the app with:

```bash
pnpm --filter appointment-app dev
```

The schema lives in `packages/appointment-app/src/schema.ts`. The service layer lives in `packages/appointment-app/src/service.ts`.

---

## Pattern 1: Blind booking inbox

**Problem.** Customers need to create bookings under a parent row that only the owner can read. The owner doesn't want to send each customer a separate invite.

**Trick.** Store the `index-submitter` link for the hidden `bookingRoots` row as a plain string field on the *readable* `schedules` row. Customers join as `content-submitter` of the schedule, then call `joinInvite(...)` on that embedded link to gain `index-submitter` access to the inbox without ever getting readable access to it.

**Owner side — create the inbox and embed its link in the schedule:**

```ts
const bookingRootWrite = this.db.create("bookingRoots", { createdAt: Date.now() });
const bookingRoot = bookingRootWrite.value;
const bookingSubmitterLinkWrite = this.db.createShareLink(bookingRoot, "index-submitter");
const scheduleWrite = this.db.create("schedules", {
  ...draftToScheduleFields(draft),
  bookingSubmitterLink: bookingSubmitterLinkWrite.value,  // stored as a plain string field on the readable row
});

await Promise.all([
  scheduleWrite.committed,
  bookingRootWrite.committed,
  bookingSubmitterLinkWrite.committed,
]);
```

**Customer side — claim `index-submitter` access from the embedded link and reuse-or-create one `scheduleUsers` row:**

```ts
async ensureBookingRootAccess(schedule: ScheduleHandle): Promise<BookingRootRef> {
  const joined = await this.db.joinInvite(schedule.fields.bookingSubmitterLink);
  return joined.ref as BookingRootRef;
}
```

```ts
async ensureScheduleUserRow(schedule: ScheduleHandle): Promise<ScheduleUserHandle> {
  const [existing] = await this.db.query("scheduleUsers", {
    in: CURRENT_USER,
    where: { scheduleRef: toRowRef(schedule) },
    limit: 1,
  });
  return existing
    ?? this.db.create("scheduleUsers", {
      scheduleRef: toRowRef(schedule),
      createdAt: Date.now(),
    }, {
      in: [toRowRef(schedule), CURRENT_USER],
    }).value;
}
```

`joinInvite` is idempotent — calling it again on a link the user already joined is a no-op. Call it every time a customer opens a schedule; no local state needed.

The customer never gets readable access to `bookingRoots`, so they cannot inspect that inbox directly or see other customers' full booking records from it.

The app links each booking into both the booking root and scheduleUser:

```ts
const booking = this.db.create("bookings", {
  slotStartMs: args.slotStartMs,
  slotEndMs: args.slotEndMs,
  claimedAtMs: Date.now(),
  scheduleUserRef: args.scheduleUser.ref,
  customerUsername: args.scheduleUser.owner,
}, {
  in: [args.bookingRootRef, args.scheduleUser.ref],
}).value;
```

The owner can enumerate bookings from `bookingRoots`. Each customer can enumerate "my bookings for this schedule" by querying `bookings` under their own `scheduleUsers` row. Cancel removes both parent links.

---

## Pattern 2: Index-key sibling visibility with `select: "indexKeys"`

**Problem.** Customers need to see which slots currently look occupied so they can avoid obvious collisions — but they shouldn't see other customers' private booking details.

**Trick.** Query with `select: "indexKeys"`. `index-*` members can run this query against the inbox without needing read access to the parent. The response is an index-key projection: it includes only `kind`, `id`, `collection`, and index-key-only `fields`.

**In the UI** — reactive:

```ts
const { rows: sharedBookings = [] } = useQuery(db, "bookings", {
  in: props.bookingRootRef,
  select: "indexKeys",
  limit: 500,
});
```

In the appointment example, the flow is **write first, then converge on the read path**:

```ts
this.db.create("bookings", {
  slotStartMs: args.slotStartMs,
  slotEndMs: args.slotEndMs,
  claimedAtMs: Date.now(),
}, {
  in: [args.bookingRootRef, args.scheduleUser.ref],
});
```

Then derive the visible winning claim from the visible rows:

1. group claims by `{ slotStartMs, slotEndMs }`
2. sort each group by `(claimedAtMs, id)`
3. use a fixed app-level cooloff window such as 5 seconds
4. before `firstClaim.claimedAtMs + cooloffMs`, treat the slot as `pending`
5. after cooloff, treat only the first claim as active
6. if that claim disappears later, recompute from the remaining rows and the next claim becomes active

`select: "indexKeys"` works in both `useQuery` and the imperative `db.query`. No additional permissions are required: `index-*` access already allows index-key sibling queries. These projections are not locatable row refs; use a full query if you need to reopen a row later.

Important: this pattern gives **shared visibility and client convergence only**.

- It does not enforce uniqueness or capacity.
- It does not prevent oversubscription.
- It is not fair against malicious writers.
- It should not be described as a hard reservation mechanism.

This gives **honest convergence**, not enforcement. All well-behaved clients will compute the same visible winner from the same visible rows, but a malicious writer can still bias the outcome by choosing favorable visible tiebreak values.

---

## Pattern 3: Minimal index-key fields

`select: "indexKeys"` only exposes fields declared `.indexKey()`. The `bookings` schema is designed so index-key projections contain just enough to render an occupied-slots calendar — nothing more:

```ts
bookings: collection({
  in: ["bookingRoots"],
  fields: {
    slotStartMs: field.number().indexKey(),  // exposed by select: "indexKeys"
    slotEndMs:   field.number().indexKey(),  // exposed by select: "indexKeys"
    claimedAtMs: field.number().indexKey(),  // visible tiebreak for read-side arbitration
  },
}),
```

**Design rule:** before marking a field `.indexKey()`, ask whether it is safe for `index-*` members to read. If not, leave `.indexKey()` off and it will never appear in index-key projections, regardless of what is added to the schema later. For this pattern, `claimedAtMs` is intentionally visible so all clients can run the same deterministic tiebreak.

---

## How the three patterns compose

The app wires all three together into a single access-control surface the owner never has to touch again:

1. **Owner creates a schedule.** During creation, a hidden `bookingRoots` row is created and its `index-submitter` link is stored in `schedule.fields.bookingSubmitterLink`.
2. **Owner shares the schedule** using a `content-submitter` link. Customers open it.
3. **Customer joins the inbox** via `bookingSubmitterLink` and ensures one `scheduleUsers` row under the schedule.
4. **Customer creates a claim** linked into both parents: `bookingRoots` and their `scheduleUsers` row.
5. **Customer queries visible claims** — Patterns 2 and 3. `select: "indexKeys"` returns index-key projections with `fields: { slotStartMs, slotEndMs, claimedAtMs }` from sibling bookings, while the `scheduleUsers` query returns the customer's full booking rows.
6. **Owner and customers converge** on the same visible winning claim from the same inbox rows, while both sides can still reopen the same booking through their respective parent link.

The owner never manually grants customer access by username. Embedded invite links, plus rows representing a user within a scope, are the whole access-control surface.
