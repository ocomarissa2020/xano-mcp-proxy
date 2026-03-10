const express = require('express');
const cors = require('cors');
const app = express();

const XANO_MCP_URL = process.env.XANO_MCP_URL || "https://xjlq-rdqz-krf6.f2.xano.io/x2/mcp/meta/mcp/stream";
const XANO_BEARER_TOKEN = process.env.XANO_BEARER_TOKEN;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["*"]
}));

app.options("*", (req, res) => {
  res.sendStatus(200);
});

// OAuth discovery endpoint
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

// OAuth authorize
app.get("/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  res.redirect(`${redirect_uri}?code=xano_auth&state=${state}`);
});

// OAuth token
app.post("/token", express.urlencoded({ extended: true }), (req, res) => {
  res.json({
    access_token: "xano_proxy_token",
    token_type: "Bearer",
    expires_in: 86400
  });
});

// Proxy to Xano MCP
app.all("*", express.json(), async (req, res) => {
  try {
    const response = await fetch(XANO_MCP_URL, {
      method: req.method,
      headers: {
        "Authorization": `Bearer ${XANO_BEARER_TOKEN}`,
        "Accept": "text/event-stream",
        "Content-Type": "application/json"
      },
      body: req.method !== "GET" ? JSON.stringify(req.body) : undefined
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    response.body.pipeTo(new WritableStream({
      write(chunk) {
        res.write(chunk);
      },
      close() {
        res.end();
      }
    }));
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Proxy error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
