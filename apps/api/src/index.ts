// API server entry point (separate process from the worker).
import { createApp } from "./app";
import { env } from "./env";

const app = createApp();
app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
