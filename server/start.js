import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(serverDirectory, ".."));
config({ path: path.resolve(serverDirectory, "..", ".env") });
await import("./index.js");
