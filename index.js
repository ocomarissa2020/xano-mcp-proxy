const express = require('express');
const cors = require('cors');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const app = express();
const XANO_MCP_URL = process.env.XANO_MCP_URL;
const XANO_BEARER_TOKEN = process.env.XANO_BEARER_TOKEN;

app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const baseUrl = `https://${req.get("host")}`;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"]
  });
});

app.get("/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  res.redirect(`${redirect_uri}?code=xano_auth&state=${state}`);
});

app.post("/token", express.urlencoded({ extended: true }), (req, res) => {
  res.json({
    access_token: "xano_proxy_token",
    token_type: "Bearer",
    expires_in: 86400
  });
});

// Connect to Xano upstream once on startup
let upstreamClient = null;

async function connectUpstream() {
  try {
    console.log("Connecting to Xano MCP...");
    const upstreamTransport = new SSEClientTransport(new URL(XANO_MCP_URL), {
      headers: { "Authorization": `Bearer ${XANO_BEARER_TOKEN}` }
    });
    upstreamClient = new Client({ name: "proxy", version: "1.0.0" }, {});
    await upstreamClient.connect(upstreamTransport);
    const { tools } = await upstreamClient.listTools();
    console.log("Connected! Tools available:", tools.length);
  } catch (err) {
    console.error("Failed to connect to Xano:", err.message);
    setTimeout(connectUpstream, 5000);
  }
}

connectUpstream();

// Streamable HTTP endpoint for ChatGPT
app.post("/mcp", async (req, res) => {
  try {
    if (!upstreamClient) {
      return res.status(503).json({ error: "Not connected to Xano yet" });
    }

    const server = new Server(
      { name: "xano-proxy", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    const { tools } = await upstreamClient.listTools();

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return await upstreamClient.callTool(request.params);
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("finish", () => {
      transport.close();
      server.close();
    });

  } catch (err) {
    console.error("MCP error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Handle GET for SSE stream (some clients use this)
app.get("/mcp", async (req, res) => {
  res.status(405).json({ error: "Use POST for MCP" });
});

const PORT = process.env
