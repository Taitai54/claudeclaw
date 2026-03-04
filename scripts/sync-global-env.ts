#!/usr/bin/env node
/**
 * Copy project .env to global env file (~/.claudeclaw-env).
 * Run from repo root so the bot can use the same keys from any clone or device
 * as long as this file exists in your home directory.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getGlobalEnvPath } from '../src/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const projectEnv = path.join(projectRoot, '.env');
const globalPath = getGlobalEnvPath();

try {
  const content = fs.readFileSync(projectEnv, 'utf-8');
  fs.writeFileSync(globalPath, content, 'utf-8');
  console.log('Saved to', globalPath);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    console.error('No .env found at', projectEnv);
    process.exit(1);
  }
  throw err;
}
