import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

// Load .env
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_STORAGE_BUCKET;

if (!supabaseUrl || !supabaseKey || !bucketName) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_STORAGE_BUCKET in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  console.log(`Testing connection to project: ${supabaseUrl}`);
  console.log(`Targeting bucket: ${bucketName}`);

  const { data, error } = await supabase.storage.listBuckets();
  
  if (error) {
    console.error("Connection failed:", error.message);
    process.exit(1);
  }

  const bucket = data.find(b => b.name === bucketName);
  
  if (bucket) {
    console.log(`SUCCESS: Found bucket '${bucketName}'!`);
  } else {
    console.error(`ERROR: Could not find bucket '${bucketName}'. Found: ${data.map(b => b.name).join(", ")}`);
    process.exit(1);
  }
}

testConnection();
