import fs from 'fs';
import os from 'os';
import path from 'path';

/** Path to global env file: ~/.claudeclaw-env (same on Windows). Use this file so the bot works from any clone or device. */
export function getGlobalEnvPath(): string {
  return path.join(os.homedir(), '.claudeclaw-env');
}

function parseEnvContent(
  content: string,
  wanted: Set<string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!wanted.has(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }
  return result;
}

/**
 * Parse env from global file (~/.claudeclaw-env) then project .env.
 * Project .env overrides global. Does NOT load into process.env.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  const wanted = new Set(keys);
  const result: Record<string, string> = {};

  const globalPath = getGlobalEnvPath();
  try {
    const globalContent = fs.readFileSync(globalPath, 'utf-8');
    Object.assign(result, parseEnvContent(globalContent, wanted));
  } catch {
    // no global file or not readable
  }

  const envFile = path.join(process.cwd(), '.env');
  try {
    const content = fs.readFileSync(envFile, 'utf-8');
    Object.assign(result, parseEnvContent(content, wanted));
  } catch {
    // no project .env
  }

  return result;
}
