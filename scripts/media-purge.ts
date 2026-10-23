import { getDb } from "@/lib/db";
import { purgeDeletedAssets } from "@/lib/domain/media";
import { RETENTION_DAYS } from "@/lib/media/storage";

async function main(): Promise<void> {
  getDb();
  const result = await purgeDeletedAssets(RETENTION_DAYS);
  console.log(
    `Purged ${result.removed} deleted media file(s), ${(result.bytes / 1024 / 1024).toFixed(1)} MB. Retention: ${RETENTION_DAYS} days.`,
  );
}

main().catch((error) => {
  console.error("Media purge failed:", error);
  process.exitCode = 1;
});
