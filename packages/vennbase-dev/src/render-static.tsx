import { renderToStaticMarkup } from "react-dom/server";
import { parseReadme } from "./parse-readme";
import { HomePage, ReferencePage } from "./site";

type StaticPagePath = "/" | "/reference/";

export function renderStaticPage(pathname: StaticPagePath, markdown: string): string {
  const content = parseReadme(markdown);

  switch (pathname) {
    case "/":
      return renderToStaticMarkup(<HomePage content={content} />);
    case "/reference/":
      return renderToStaticMarkup(<ReferencePage content={content} />);
    default:
      return assertNever(pathname);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported static page path: ${String(value)}`);
}
