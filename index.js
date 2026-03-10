const express = require('express');
const cors = require('cors');
const app = express();

const XANO_MCP_URL = process.env.XANO_MCP_URL;
const XANO_BEARER_TOKEN = process.env.XANO_BEARER_TOKEN;

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["*"] }));
app.use(express.json());
app.options("*", (req, res) => res.sendStatus(200));

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

app.get("/sse", async (req, res) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const response = await fetch(XANO_MCP_URL, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${XANO_BEARER_TOKEN}`,
        "Accept": "text/event-stream"
      }
    });

    console.log("Xano SSE response status:", response.status);

    response.body.pipeTo(new WritableStream({
      write(chunk) { res.write(chunk); },
      close() { res.end(); }
    }));
  } catch (err) {
    console.error("SSE error:", err);
    res.status(500).end();
  }
});

app.post("/sse/messages", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const xanoMessagesUrl = XANO_MCP_URL.replace('/sse', '/messages') + `?sessionId=${sessionId}`;
    
    console.log("Forwarding to:", xanoMessagesUrl);

    const response = await fetch(xanoMessagesUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${XANO_BEARER_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.text();
    res.status(response.status).send(data);
  } catch (err) {
    console.error("Messages error:", err);
    res.status(500).end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
