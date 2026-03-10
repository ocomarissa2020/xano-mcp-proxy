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

app.use(cors({ origin: "*" }));
app.use(express.json());

// Auth0 JWT validator
const checkJwt = auth({
  audience: AUTH0_AUDIENCE,
  issuerBaseURL: `https://${AUTH0_DOMAIN}`,
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const baseUrl = `https://${req.get("host")}`;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `https://${AUTH0_DOMAIN}/authorize`,
    token_endpoint: `https://${AUTH0_DOMAIN}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"]
  });
});

app.get("/authorize", (req, res) => {
  const { redirect_uri, state, code_challenge, code_challenge_method } = req.query;
  const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
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
  const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
  const AUTH0_CLIENT_SECRET = pr
