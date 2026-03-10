const express = require('express');
const cors = require('cors');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { auth } = require('express-oauth2-jwt-bearer');

const app = express();
const XANO_MCP_URL = process.env.XANO_MCP_URL;
const XANO_BEARER_TOKEN = process.env.XANO_BEARER_TOKEN;
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
const AUTH0_CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET;

app.use(cors({ origin: "*" }));
app.use(express.json());

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} | Auth: ${(req.headers.authorization || "NONE").substring(0, 50)}`);
  next();
});

const checkJwt = auth({
  audience: AUTH0_AUDIENCE,
  issuerBaseURL: `https://${AUTH0_DOMAIN}`,
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const baseUrl = `https://${req.get("host")}`;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    scopes_supported: ["openid", "profile", "email"],
    code_challenge_methods_supported: ["S256"]
  });
});

app.get("/authorize", (req, res) => {
  const { redirect_uri, state, code_challenge, code_challenge_method } = req.query;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: AUTH0_CLIENT_ID,
    redirect_uri,
    state,
    audience: AUTH0_AUDIENCE,
    ...(code_challenge && { code_challenge }),
    ...(code_challenge_method && { code_challenge_method })
  });
  res.redirect(`https://${AUTH0_DOMAIN}/authorize?${params}`);
});

app.post("/token", express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const response = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: AUTH0_CLIENT_ID,
        client_secret: AUTH0_CLIENT_SECRET,
        code: req.body.code,
        redirect_uri: req.body.redirect_uri,
        ...(req.body.code_verifier && { code_verifier: req.body.code_verifier })
      })
    });
    const data = await response.json();
    console.log("Token exchange result:", JSON.stringify(data).substring(0, 200));
    res.json(data);
  } catch (err) {
    console.error("Token exchange error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/mcp", (req, res) => {
  res.status(200).json({ name: "xano-proxy", version: "1.0.0", capabilities: { tools: {} } });
});

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

app.post("/mcp", async (req, res, next) => {
  const authHeader = req.headers.authorization || "NONE";
  console.log("Auth header:", authHeader.substring(0, 80));
  next();
}, checkJwt, async (req, res) => {
  console.log("POST /mcp:", req.body?.method);
  try {
    if (!upstreamClient) {
      return res.status(503).json({ error: "Not connected to Xano" });
    }
    const server = new Server(
      { name: "xano-proxy", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: cachedTools }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      console.log("Calling tool:", request.params.name);
      const result = await upstreamClient.callTool({
        name: request.params.name,
        arguments: request.params.arguments || {}
      });
      console.log("Tool result:", JSON.stringify(result).substring(0, 300));
      return result;
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
