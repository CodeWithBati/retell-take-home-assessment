import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve against the project root so the scripts work from any directory.
export const ROOT_DIR = path.resolve(fileURLToPath(import.meta.url), '../..');

export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'atlas.db');
export const DEFAULT_CSV_PATH = process.env.CSV_PATH || path.join(DATA_DIR, 'atlas_inventory.csv');
export const REJECTS_PATH = path.join(DATA_DIR, 'rejects.csv');
export const SCHEMA_PATH = path.join(ROOT_DIR, 'src', 'schema.sql');
