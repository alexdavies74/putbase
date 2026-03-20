import { collection, defineSchema, field, index } from "@putbase/core";

export const schema = defineSchema({
  boards: collection({
    fields: {
      title: field.string(),
    },
  }),
  recentBoards: collection({
    in: ["user"],
    fields: {
      boardTarget: field.string(),
      openedAt: field.number(),
    },
    indexes: {
      byBoardTarget: index("boardTarget"),
      byOpenedAt: index("openedAt"),
    },
  }),
  cards: collection({
    in: ["boards"],
    fields: {
      text: field.string(),
      done: field.boolean(),
      createdAt: field.number(),
    },
    indexes: {
      byCreatedAt: index("createdAt"),
    },
  }),
});

export type Schema = typeof schema;
