import rawReadme from "../../vennbase-core/README.md?raw";
import { parseReadme } from "./parse-readme";

export const readmeContent = parseReadme(rawReadme);
