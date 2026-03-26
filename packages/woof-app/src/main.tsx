import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { VennbaseProvider } from "@vennbase/react";

import { App } from "./App";
import { db } from "./services";

const appElement = document.getElementById("app");
if (!appElement) {
  throw new Error("#app element missing");
}

createRoot(appElement).render(
  <StrictMode>
    <VennbaseProvider db={db}>
      <App />
    </VennbaseProvider>
  </StrictMode>,
);
