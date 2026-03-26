import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/fraunces/latin-700.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-700.css";
import "./styles.css";
import { readmeContent } from "./readme-source";
import { ReferencePage } from "./site";

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Missing #app root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ReferencePage content={readmeContent} />
  </StrictMode>,
);
