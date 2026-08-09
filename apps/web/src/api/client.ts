import { treaty } from "@elysiajs/eden";
import type { App } from "../../../server/src/app";

// The type is imported from the server directly — no code generation, no schema
// file to regenerate. Changing a route's shape breaks the build here.
export const client = treaty<App>(window.location.origin);
