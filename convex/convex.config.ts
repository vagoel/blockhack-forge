import { defineApp } from "convex/server";
import presence from "@convex-dev/presence/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app = defineApp();
app.use(presence);
app.use(rateLimiter);

export default app;
