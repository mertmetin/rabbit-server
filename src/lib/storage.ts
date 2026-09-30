import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Private file storage (delivery photos). On disk for now under
// STORAGE_DIR; in production this should move to S3 (same interface).
const root = () => path.resolve(process.env.STORAGE_DIR ?? "storage-files");

function safePath(key: string) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export async function saveFile(key: string, data: Buffer) {
  const full = safePath(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

export async function loadFile(key: string): Promise<Buffer | null> {
  try {
    return await readFile(safePath(key));
  } catch {
    return null;
  }
}
