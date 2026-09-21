/**
 * FIT file storage. Cloud Run's own filesystem is ephemeral, so uploads live
 * in a GCS bucket in production; locally, with no GCS_BUCKET set, they land
 * under uploads/ so `npm run dev` needs no cloud setup at all.
 */
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const bucketName = process.env.GCS_BUCKET

let bucket: import('@google-cloud/storage').Bucket | null = null

async function getBucket(): Promise<import('@google-cloud/storage').Bucket> {
  if (!bucket) {
    const { Storage } = await import('@google-cloud/storage')
    bucket = new Storage().bucket(bucketName as string)
  }
  return bucket
}

export async function saveUpload(objectPath: string, buffer: Buffer): Promise<void> {
  if (bucketName) {
    await (await getBucket()).file(objectPath).save(buffer)
    return
  }
  const dest = resolve('./uploads', objectPath)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, buffer)
}

export async function deleteUpload(objectPath: string): Promise<void> {
  if (bucketName) {
    await (await getBucket()).file(objectPath).delete({ ignoreNotFound: true })
    return
  }
  await unlink(resolve('./uploads', objectPath)).catch(() => {})
}
