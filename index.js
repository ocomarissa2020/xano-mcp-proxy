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
