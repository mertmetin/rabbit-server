import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Private file storage (delivery photos). In S3 when STORAGE_BUCKET is set
// (production: the server's disk is wiped on every deploy), otherwise on disk
// under STORAGE_DIR.
let s3: S3Client | null = null;
const bucket = () => process.env.STORAGE_BUCKET;
const client = () => (s3 ??= new S3Client({ region: process.env.AWS_REGION ?? "ca-central-1" }));

const root = () => path.resolve(process.env.STORAGE_DIR ?? "storage-files");

function safePath(key: string) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export async function saveFile(key: string, data: Buffer) {
  const Bucket = bucket();
  if (Bucket) {
    await client().send(new PutObjectCommand({ Bucket, Key: key, Body: data }));
    return;
  }
  const full = safePath(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

export async function loadFile(key: string): Promise<Buffer | null> {
  const Bucket = bucket();
  if (Bucket) {
    try {
      const res = await client().send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (e) {
      if (e instanceof NoSuchKey) return null;
      throw e;
    }
  }
  try {
    return await readFile(safePath(key));
  } catch {
    return null;
  }
}
