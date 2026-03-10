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

app.get("/mcp", (req, res) => {
  res.status(200).json({ name: "xano-proxy", version: "1.0.0", capabilities: { tools: {} } });
});

// Keep one persistent upstream connection
let upstreamClient = null;
let cachedTools = [];

async function connectUpstream() {
  try {
    console.log("Connecting to Xano MCP...");
    
    if (upstreamClient) {
      try { await upstreamClient.close(); } catch(e) {}
    }

    const upstreamTransport = new SSEClientTransport(new URL(XANO_MCP_URL), {
      requestInit: {
        headers: { "Authorization": `Bearer ${XANO_BEARER_TOKEN}` }
      }
    });
    
    upstreamClient = new Client({ name: "proxy", version: "1.0.0" }, {});
    
    upstreamClient.onerror = (err) => {
      console.error("Upstream error:", err.message);
      upstreamClient = null;
      setTimeout(connectUpstream, 3000);
    };

    await upstreamClient.connect(upstreamTransport);
    const { tools } = await upstreamClient.listTools();
    cachedTools = tools;
    console.log("Connected! Tools available:", tools.length);
    
  } catch (err) {
    console.error("Failed to connect:", err.message);
    upstreamClient = null;
    setTimeout(connectUpstream, 5000);
  }
}

connectUpstream();

app.post("/mcp", async (req, res) => {
  console.log("POST /mcp:", req.body?.method);
  
  try {
    if (!upstreamClient) {
      return res.status(503).json({ 
        jsonrpc: "2.0", 
        id: req.body?.id,
        error: { code: -32603, message: "Not connected to Xano" } 
      });
    }

    const server = new Server(
      { name: "xano-proxy", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ 
      tools: cachedTools 
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      console.log("Calling tool:", request.params.name);
      try {
        const result = await upstreamClient.callTool({
          name: request.params.name,
          arguments: request.params.arguments || {}
        });
        console.log("Tool result:", JSON.stringify(result).substring(0, 300));
        return result;
      } catch (err) {
        console.error("Tool call error:", err.message);
        throw err;
      }
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
    console.error("MCP error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
