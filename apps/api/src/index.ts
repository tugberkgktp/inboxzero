// API server entry point (separate process from the worker).
import { createApp } from "./app";
import { env } from "./env";
import { prisma } from "./db";

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

// Drain connections cleanly when the container is stopped.
const shutdown = () => {
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
