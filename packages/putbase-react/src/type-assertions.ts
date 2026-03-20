import {
  collection,
  defineSchema,
  field,
  index,
  type AnyRowHandle,
  type DbRowRef,
} from "@putbase/core";

import { useQuery, useRow } from "./index";

const schema = defineSchema({
  dogs: collection({
    fields: {
      name: field.string(),
    },
  }),
  tags: collection({
    in: ["dogs"],
    fields: {
      label: field.string(),
      createdAt: field.number(),
    },
    indexes: {
      byCreatedAt: index("createdAt"),
    },
  }),
});

type TestSchema = typeof schema;

type DogResult = ReturnType<typeof useRow<TestSchema, "dogs">>;
type TagRows = ReturnType<typeof useQuery<TestSchema, "tags">>["rows"];

declare const dogResult: DogResult;
declare const tagRows: TagRows;
declare const tagRef: DbRowRef<"tags">;

const maybeAnyRowHandle: AnyRowHandle<TestSchema> | undefined = dogResult.data;
void maybeAnyRowHandle;

if (dogResult.data) {
  // @ts-expect-error parentless rows should not accept parent refs
  void dogResult.data.in.add(tagRef);
}

if (tagRows[0]) {
  void tagRows[0].in.add({
    id: "dog_1",
    collection: "dogs",
    owner: "alex",
    target: "https://worker.example/rows/dog_1",
  });

  // @ts-expect-error tags can only be parented by dogs
  void tagRows[0].in.add(tagRef);
}

export {};
