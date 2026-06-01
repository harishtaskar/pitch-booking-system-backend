import { createServer } from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { connectRedis } from "./config/redis";
import { initSockets } from "./sockets";

async function main() {
  await connectRedis();

  const app = createApp();
  const httpServer = createServer(app);

  await initSockets(httpServer);

  httpServer.listen(env.PORT, () => {
    console.log(`🏏 API + Socket.io listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
