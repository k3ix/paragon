import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { app } from "./app";

// Vite proxies /api during development, so requests are same-origin and CORS is not
// strictly needed. It is enabled anyway for the case of opening a built bundle or a
// separate client directly against this port.
const server = new Elysia().use(cors()).use(app).listen(3000);

console.log(`Paragon API on http://localhost:${server.server?.port}`);
