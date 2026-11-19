import { createServer } from "node:http";

const port = Number(process.env.PORT) || 3030;

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>Finbuu</title><h1>Finbuu is live</h1>");
});

server.listen(port, "0.0.0.0", () => console.log(`Listening on ${port}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
