import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { defaultDbPath, getDb } from "@/lib/db";
import { MEDIA_ROOT, ensureMediaRoot } from "@/lib/media/storage";

async function main(): Promise<void> {
  const db = getDb();
  db.pragma("wal_checkpoint(TRUNCATE)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(process.cwd(), "data", "backups", stamp);
  await fsp.mkdir(dest, { recursive: true });

  const dbPath = defaultDbPath();
  const dbDest = path.join(dest, path.basename(dbPath));
  await db.backup(dbDest);

  ensureMediaRoot();
  const mediaDest = path.join(dest, "media");
  await fsp.cp(MEDIA_ROOT, mediaDest, { recursive: true, errorOnExist: false });

  let files = 0;
  let bytes = 0;
  async function walk(directory: string): Promise<void> {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        files += 1;
        bytes += (await fsp.stat(full)).size;
      }
    }
  }
  await walk(mediaDest);

  const manifest = {
    createdAt: new Date().toISOString(),
    database: {
      source: dbPath,
      file: path.basename(dbDest),
      bytes: fs.statSync(dbDest).size,
    },
    media: {
      source: MEDIA_ROOT,
      folder: "media",
      files,
      bytes,
    },
    restore:
      "Stop the app, copy the database file back to HOMEORBIT_DB_PATH (or data/homeorbit.db), copy media/* into MEDIA_STORAGE_PATH (or data/media), then start the app.",
  };
  await fsp.writeFile(path.join(dest, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Backup written to ${dest}`);
  console.log(`Database: ${(manifest.database.bytes / 1024 / 1024).toFixed(2)} MB · media: ${files} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log("Keep backups off the Mac Studio (encrypted external disk or private NAS). Test a restore regularly.");
}

main().catch((error) => {
  console.error("Backup failed:", error);
  process.exitCode = 1;
});
