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

// Proxy to Xano Streamable HTTP endpoint
app.post("/mcp", async (req, res) => {
  try {
    const response = await fetch(XANO_MCP_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${XANO_BEARER_TOKEN}`,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"
      },
      body: JSON.stringify(req.body)
    });

    const contentType = response.headers.get("content-type") || "application/json";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (contentType.includes("text/event-stream")) {
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      response.body.pipeTo(new WritableStream({
        write(chunk) { res.write(chunk); },
        close() { res.end(); }
      }));
    } else {
      const data = await response.text();
      res.status(response.status).send(data);
    }
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Proxy error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
```

Also make sure your Railway `XANO_MCP_URL` variable is set to the **stream** endpoint:
```
https://xjlq-rdqz-krf6.f2.xano.io/x2/mcp/meta/mcp/stream
```

Commit, wait for redeploy, then try ChatGPT with:
```
https://xano-mcp-proxy-production.up.railway.app/mcp
