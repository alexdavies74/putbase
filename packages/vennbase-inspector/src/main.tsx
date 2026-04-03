import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

const appElement = document.getElementById("app");
if (!appElement) {
  throw new Error("#app element missing");
}

createRoot(appElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
