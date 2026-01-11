import { buildServer } from "./server";
import { config } from "./config";

const app = buildServer();

app
  .listen({ port: config.PORT, host: "0.0.0.0" })
  .then((address) => {
    app.log.info(`API listening on ${address}`);
  })
  .catch((error) => {
    app.log.error(error, "Failed to start API");
    process.exit(1);
  });
