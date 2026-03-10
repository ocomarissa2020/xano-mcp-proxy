const express = require('express');
const cors = require('cors');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
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

const transports = {};

app.get("/sse", async (req, res) => {
  console.log("New SSE connection");

  try {
    const upstreamTransport = new SSEClientTransport(new URL(XANO_MCP_URL), {
      headers: { "Authorization": `Bearer ${XANO_BEARER_TOKEN}` }
    });

    const upstreamClient = new Client({ name: "proxy", version: "1.0.0" }, {});
    await upstreamClient.connect(upstreamTransport);

    const { tools } = await upstreamClient.listTools();
    console.log("Upstream tools count:", tools.length);

    const server = new Server(
      { name: "xano-proxy", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return await upstreamClient.callTool(request.params);
    });

    const downstreamTransport = new SSEServerTransport("/sse/messages", res);
    transports[downstreamTransport.sessionId] = { transport: downstreamTransport, client: upstreamClient };

    await server.connect(downstreamTransport);

  } catch (err) {
    console.error("SSE setup error:", err);
    res.status(500).end();
  }
});

app.post("/sse/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId]?.transport;

  if (!transport) {
    return res.status(404).send("Session not found");
  }

  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
