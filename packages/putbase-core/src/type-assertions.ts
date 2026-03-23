import { PutBase } from "./putbase";
import {
  collection,
  defineSchema,
  field,
  index,
  type DbRowRef,
} from "./schema";

const typeTestSchema = defineSchema({
  projects: collection({
    fields: {
      name: field.string(),
    },
  }),
  teams: collection({
    fields: {
      name: field.string(),
    },
  }),
  tasks: collection({
    in: ["projects"],
    fields: {
      title: field.string(),
      status: field.string().default("todo"),
      points: field.number().optional(),
    },
    indexes: {
      byStatus: index("status"),
      byTitleStatus: index(["title", "status"]),
    },
  }),
  gameRecords: collection({
    in: ["user"],
    fields: {
      gameTarget: field.string(),
      role: field.string(),
    },
    indexes: {
      byGameTarget: index("gameTarget"),
    },
  }),
  mixedRecords: collection({
    in: ["user", "projects"],
    fields: {
      label: field.string(),
    },
  }),
});

declare const projectRef: DbRowRef<"projects">;
declare const teamRef: DbRowRef<"teams">;
declare const userRef: DbRowRef<"user">;

const db = new PutBase({
  schema: typeTestSchema,
  identityProvider: async () => ({ username: "typecheck" }),
});

// @ts-expect-error tasks require an explicit project scope on insert
void db.put("tasks", { title: "Ship v2" });
void db.put("tasks", { title: "Ship v2", points: 3 }, { in: projectRef });
void db.put("gameRecords", { gameTarget: "https://workers.example/rows/game_1", role: "owner" });
void db.put("gameRecords", { gameTarget: "https://workers.example/rows/game_1", role: "owner" }, { in: userRef });

// @ts-expect-error tasks.title is required on insert
void db.put("tasks", {});

// @ts-expect-error tasks can only be created under projects
void db.put("tasks", { title: "Ship v2" }, { in: teamRef });

void db.query("tasks", { in: projectRef, where: { status: "done" } });
void db.query("tasks", { in: projectRef, index: "byStatus", value: "done" });
void db.query("tasks", { in: projectRef, index: "byTitleStatus", value: ["Ship v2", "done"] });
void db.query("gameRecords", { where: { role: "owner" } });
void db.query("gameRecords", { index: "byGameTarget", value: "https://workers.example/rows/game_1" });

// @ts-expect-error invalid where field
void db.query("tasks", { in: projectRef, where: { missing: "nope" } });

// @ts-expect-error invalid index name
void db.query("tasks", { in: projectRef, index: "byMissing", value: "done" });

// @ts-expect-error composite indexes require tuple values
void db.query("tasks", { in: projectRef, index: "byTitleStatus", value: "done" });

// @ts-expect-error tasks can only be queried under projects
void db.query("tasks", { in: teamRef });

// @ts-expect-error mixed parent collections still require an explicit scope
void db.query("mixedRecords", { where: { label: "x" } });

// @ts-expect-error mixed parent collections still require an explicit scope on insert
void db.put("mixedRecords", { label: "x" });

const projectWrite = db.put("projects", { name: "Website" });
const project = projectWrite.value;
const projectName: string = project.fields.name;
void projectName;
void projectWrite.settled;

const taskWrite = db.put("tasks", { title: "Ship v2" }, { in: projectRef });
const task = taskWrite.value;
const title: string = task.fields.title;
const status: string = task.fields.status;
const maybePoints: number | undefined = task.fields.points;
void title;
void status;
void maybePoints;
void taskWrite.settled;
void task.in.add(projectRef);
void task.in.list().then((parents) => {
  const firstParent = parents[0];
  if (firstParent) {
    const name: "projects" = firstParent.collection;
    void name;
  }
});

// @ts-expect-error tasks can only link to projects
void task.in.add(teamRef);

void db.openTarget("https://workers.example/rows/row_1").then((row) => {
  const collection: "projects" | "teams" | "tasks" | "gameRecords" | "mixedRecords" = row.collection;
  void collection;

  if (row.collection === "projects" || row.collection === "teams") {
    const name: string = row.fields.name;
    void name;
  }

  if (row.collection === "tasks") {
    const title: string = row.fields.title;
    void title;
  }

  if (row.collection === "gameRecords") {
    const role: string = row.fields.role;
    void role;
  }

  if (row.collection === "mixedRecords") {
    const label: string = row.fields.label;
    void label;
  }
});

// @ts-expect-error "user" is a reserved built-in collection name
defineSchema({
  user: collection({
    fields: {
      name: field.string(),
    },
  }),
});

export {};
