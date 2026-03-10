const { spawn } = require('child_process');
const express = require('express');
const app = express();

const XANO_MCP_URL = process.env.XANO_MCP_URL;
const XANO_BEARER_TOKEN = process.env.XANO_BEARER_TOKEN;

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

app.all("/mcp", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const response = await fetch(XANO_MCP_URL, {
    method: req.method,
    headers: {
      "Authorization": `Bearer ${XANO_BEARER_TOKEN}`,
      "Accept": "text/event-stream",
      "Content-Type": "application/json"
    },
    body: req.method !== "GET" ? JSON.stringify(req.body) : undefined
  });

  response.body.pipeTo(new WritableStream({
    write(chunk) { res.write(chunk); },
    close() { res.end(); }
  }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
