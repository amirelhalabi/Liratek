import { getDatabase } from "./index";
import fs from "fs";
import path from "path";

interface _Migration {
  id: number;
  name: string;
  applied_at: string;
}

export function runMigrations(): void {
  const db = getDatabase();
  const schemaPath = path.join(__dirname, "create_db.sql");

  if (fs.existsSync(schemaPath)) {
    console.log("Applying database schema...");
    const sql = fs.readFileSync(schemaPath, "utf-8");
    db.exec(sql);
    console.log("Database schema applied (Consolidated)");
  } else {
    console.error("Error: create_db.sql not found at", schemaPath);
  }
}
