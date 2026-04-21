import { supabase } from "./supabase.server";

const bucketName = process.env.SUPABASE_STORAGE_BUCKET || "snarky-cat-assets";

/**
 * Uploads a file directly (used by admin dashboard)
 */
export async function uploadAsset(file: File, key: string) {
  const buffer = Buffer.from(await file.arrayBuffer());
  
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(key, buffer, {
      contentType: file.type,
      upsert: true
    });

  if (error) {
    throw new Error(`Supabase Upload Error: ${error.message}`);
  }

  return data.path;
}

/**
 * Generates a short-lived presigned URL for secure customer downloads
 */
export async function getAssetSignedUrl(key: string, expiresInMinutes: number = 5) {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(key, expiresInMinutes * 60);

  if (error) {
    throw new Error(`Supabase Signed URL Error: ${error.message}`);
  }

  return data.signedUrl;
}
