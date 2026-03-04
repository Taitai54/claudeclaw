#!/usr/bin/env node
/**
 * MegaRAG MCP Server
 * Wraps the MegaRAG REST API and exposes it as MCP tools so Claude can
 * query, upload and list documents from your personal RAG knowledge base.
 *
 * Tools exposed:
 *   megarag_query               – semantic search + RAG answer
 *   megarag_upload              – upload a file for processing
 *   megarag_list_documents      – list all indexed documents
 *
 * Usage (stdio transport):
 *   node megarag-mcp.mjs
 *
 * Environment (falls back to localhost:3000 when not set):
 *   MEGARAG_BASE_URL   e.g. http://localhost:3000
 */

import { createReadStream, existsSync } from 'fs';
import { basename } from 'path';
import { ReadableStream } from 'stream/web';

const BASE_URL = process.env.MEGARAG_BASE_URL || 'http://localhost:3000';

// ─── MCP wire protocol helpers ─────────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function makeToolResult(content, isError = false) {
  return {
    content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }],
    isError,
  };
}

// ─── Tool definitions ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'megarag_query',
    description:
      'Search your personal knowledge base and get an AI-generated answer with cited sources. ' +
      'Use this whenever the user asks about documents they have uploaded, or needs information ' +
      'retrieved from their files.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The question or search query',
        },
        mode: {
          type: 'string',
          enum: ['naive', 'local', 'global', 'hybrid', 'mix'],
          description: 'Query mode. "mix" (default) is recommended — combines chunk search + knowledge graph.',
          default: 'mix',
        },
        top_k: {
          type: 'number',
          description: 'Number of document chunks to retrieve (default: 10, max: 50)',
          default: 10,
        },
        workspace: {
          type: 'string',
          description: 'Workspace name to query (default: "default")',
          default: 'default',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'megarag_upload',
    description:
      'Upload a local file to MegaRAG for processing and indexing. ' +
      'Supported types: pdf, docx, pptx, xlsx, txt, md, mp4, mp3, wav, jpg, png.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to upload',
        },
        workspace: {
          type: 'string',
          description: 'Workspace to upload into (default: "default")',
          default: 'default',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'megarag_list_documents',
    description: 'List all documents indexed in MegaRAG, with their status and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          description: 'Filter by workspace (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of documents to return (default: 50)',
          default: 50,
        },
      },
    },
  },
];

// ─── Tool implementations ──────────────────────────────────────────────────

async function megarag_query({ query, mode = 'mix', top_k = 10, workspace = 'default' }) {
  const res = await fetch(`${BASE_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, mode, top_k, workspace }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MegaRAG query failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  // Format the response nicely for Claude
  let out = '';
  if (data.answer) {
    out += `**Answer:**\n${data.answer}\n`;
  }
  if (data.sources && data.sources.length > 0) {
    out += `\n**Sources (${data.sources.length}):**\n`;
    for (const s of data.sources) {
      out += `- ${s.document_name || s.filename || s.id}`;
      if (s.score != null) out += ` (score: ${s.score.toFixed(3)})`;
      out += '\n';
      if (s.content) out += `  > ${s.content.slice(0, 200).replace(/\n/g, ' ')}…\n`;
    }
  }
  if (!out) out = JSON.stringify(data, null, 2);

  return out;
}

async function megarag_upload({ file_path, workspace = 'default' }) {
  if (!existsSync(file_path)) {
    throw new Error(`File not found: ${file_path}`);
  }

  // Use FormData with a Blob-like approach compatible with Node 18+
  const { default: FormData } = await import('formdata-node').catch(() => ({ default: null }));

  if (FormData) {
    // formdata-node available
    const { fileFromPath } = await import('formdata-node/file-from-path');
    const form = new FormData();
    form.set('file', await fileFromPath(file_path));
    form.set('workspace', workspace);

    const res = await fetch(`${BASE_URL}/api/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
    return await res.json();
  }

  // Fallback: Node built-in FormData (Node 18.13+)
  const form = new globalThis.FormData();
  const fileBytes = await import('fs/promises').then(m => m.readFile(file_path));
  const blob = new Blob([fileBytes]);
  form.append('file', blob, basename(file_path));
  form.append('workspace', workspace);

  const res = await fetch(`${BASE_URL}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
  const data = await res.json();

  return `Uploaded successfully.\nDocument ID: ${data.document_id || data.id}\nStatus: ${data.status || 'processing'}\nPoll status at: GET /api/status/${data.document_id || data.id}`;
}

async function megarag_list_documents({ workspace, limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (workspace) params.set('workspace', workspace);

  const res = await fetch(`${BASE_URL}/api/documents?${params}`);
  if (!res.ok) throw new Error(`List failed (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const docs = Array.isArray(data) ? data : data.documents || data.data || [];

  if (docs.length === 0) return 'No documents found.';

  const lines = docs.map((d, i) => {
    const name = d.filename || d.name || d.id;
    const status = d.status || 'unknown';
    const ws = d.workspace || 'default';
    const created = d.created_at ? new Date(d.created_at).toLocaleDateString() : '';
    return `${i + 1}. [${status}] ${name} (workspace: ${ws}${created ? ', ' + created : ''})`;
  });

  return `**Documents (${docs.length}):**\n${lines.join('\n')}`;
}

// ─── Dispatch table ────────────────────────────────────────────────────────

const HANDLERS = { megarag_query, megarag_upload, megarag_list_documents };

// ─── MCP stdio message loop ────────────────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', async chunk => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop(); // keep incomplete last line

  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    await handleMessage(msg);
  }
});

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'megarag-mcp', version: '1.0.0' },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    const handler = HANDLERS[toolName];

    if (!handler) {
      send({
        jsonrpc: '2.0',
        id,
        result: makeToolResult(`Unknown tool: ${toolName}`, true),
      });
      return;
    }

    try {
      const result = await handler(toolArgs);
      send({ jsonrpc: '2.0', id, result: makeToolResult(result) });
    } catch (err) {
      send({ jsonrpc: '2.0', id, result: makeToolResult(err.message, true) });
    }
    return;
  }

  // Unknown method
  send({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

process.stdin.on('end', () => process.exit(0));
