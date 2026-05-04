import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { mountBullBoard } from "./lib/bullBoard";
import { userContext } from "./middlewares/userContext";
import { queryCountStore, getRequestQueryCount } from "@workspace/db";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

// BullBoard mounts BEFORE express.json so its internal routes work.
mountBullBoard(app);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use("/api", (req, res, next) => {
  queryCountStore.run({ count: 0 }, () => {
    const origJson = res.json.bind(res);
    res.json = function (body: unknown) {
      const count = getRequestQueryCount();
      if (count >= 0) res.setHeader("X-Query-Count", String(count));
      return origJson(body);
    };
    userContext(req, res, () => {
      router(req, res, next);
    });
  });
});

export default app;
