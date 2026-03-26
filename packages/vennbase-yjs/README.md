# `@vennbase/yjs`

Yjs adapters for Vennbase CRDT sync.

`@vennbase/yjs` uses the app's `yjs` instance instead of bundling its own runtime. Install both packages and pass your `Y` module into `createYjsAdapter`.

```ts
import * as Y from "yjs";
import { createYjsAdapter } from "@vennbase/yjs";

const adapter = createYjsAdapter(Y);
```
