import { buildApp } from "./apps/api/dist/app.js";

const app = buildApp();
console.log("App built OK:", typeof app);

await app.ready();
console.log("App ready");

await app.close();
console.log("App closed");
process.exit(0);