# `@putbase/yjs`

Yjs bindings for PutBase CRDT sync.

`@putbase/yjs` uses the app's `yjs` instance instead of bundling its own runtime. Install both packages and pass your `Y` module into `createYjsBinding`.

```ts
import * as Y from "yjs";
import { createYjsBinding } from "@putbase/yjs";

const binding = createYjsBinding(Y);
```
