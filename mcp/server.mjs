#!/usr/bin/env node
/**
 * Mac PDF Editor — Model Context Protocol (MCP) stdio server.
 * Connects to the running Mac PDF Editor HTTP Control API on http://127.0.0.1:4890.
 */

const API_BASE = process.env.MAC_PDF_EDITOR_URL || "http://127.0.0.1:4890";

const TOOLS = [
  {
    name: "pdf_editor_health",
    description: "Check if Mac PDF Editor app and its local HTTP API (port 4890) are running.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "pdf_editor_get_state",
    description: "Get current open PDF file path, page count, current page, zoom, annotations count, and metadata.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "pdf_editor_open",
    description: "Open a PDF file in Mac PDF Editor.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute path to PDF file" } },
      required: ["path"],
    },
  },
  {
    name: "pdf_editor_extract_text",
    description: "Extract text from all pages or a specific 0-based page index of the open PDF.",
    inputSchema: {
      type: "object",
      properties: { pageIndex: { type: "number", description: "Optional 0-based page index" } },
    },
  },
  {
    name: "pdf_editor_search_text",
    description: "Search for a text query across all pages of the open PDF.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query string" } },
      required: ["query"],
    },
  },
  {
    name: "pdf_editor_page_rotate",
    description: "Rotate a page by 90, 180, or 270 degrees.",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number", description: "0-based page index (defaults to current page)" },
        degrees: { type: "number", description: "Rotation angle (90, 180, 270)" },
      },
    },
  },
  {
    name: "pdf_editor_add_annotation",
    description: "Add a text, highlight, rect, or draw annotation to a page.",
    inputSchema: {
      type: "object",
      properties: {
        pageIndex: { type: "number", description: "0-based page index" },
        annotation: { type: "object", description: "Annotation object (type, x, y, color, etc.)" },
      },
      required: ["annotation"],
    },
  },
  {
    name: "pdf_editor_save",
    description: "Save the edited PDF document to disk.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Optional output path" } },
    },
  },
  {
    name: "pdf_editor_compress",
    description: "Compress the current PDF using the Rust lopdf engine and save to outputPath.",
    inputSchema: {
      type: "object",
      properties: { outputPath: { type: "string", description: "Output path for compressed PDF" } },
      required: ["outputPath"],
    },
  },
  {
    name: "pdf_editor_export_png",
    description: "Export the current page (including annotations) as a PNG image.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Output PNG path" } },
      required: ["path"],
    },
  },
];

async function callApi(action, payload = {}) {
  if (action === "health") {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  }
  const res = await fetch(`${API_BASE}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  return res.json();
}

function sendJsonRpc(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const { id, method, params } = req;

    if (method === "initialize") {
      sendJsonRpc({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mac-pdf-editor-mcp", version: "0.1.0" },
        },
      });
    } else if (method === "notifications/initialized") {
      // No response needed
    } else if (method === "tools/list") {
      sendJsonRpc({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      });
    } else if (method === "tools/call") {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const actionMap = {
        pdf_editor_health: "health",
        pdf_editor_get_state: "get_state",
        pdf_editor_open: "open",
        pdf_editor_extract_text: "extract_text",
        pdf_editor_search_text: "search_text",
        pdf_editor_page_rotate: "page_rotate",
        pdf_editor_add_annotation: "annotation_add",
        pdf_editor_save: "save",
        pdf_editor_compress: "compress",
        pdf_editor_export_png: "export_png",
      };
      const action = actionMap[toolName];
      if (!action) {
        sendJsonRpc({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        });
        continue;
      }

      try {
        const result = await callApi(action, args);
        sendJsonRpc({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        });
      } catch (err) {
        sendJsonRpc({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: `API error: ${String(err)}` }],
          },
        });
      }
    } else if (id !== undefined) {
      sendJsonRpc({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }
  }
});
