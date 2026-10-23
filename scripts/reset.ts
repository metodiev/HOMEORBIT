import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.HOMEORBIT_DB_PATH
  ? path.resolve(process.env.HOMEORBIT_DB_PATH)
  : path.join(process.cwd(), "data", "homeorbit.db");

for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  const file = `${dbPath}${suffix}`;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    console.log(`Removed ${file}`);
  }
}
console.log("Database reset. Run `npm run db:seed` to load the demo household.");
