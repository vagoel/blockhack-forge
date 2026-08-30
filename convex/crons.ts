import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("poll devin", { seconds: 30 }, internal.devinActions.poll, {});
crons.interval("recover vercel deployments", { minutes: 1 }, internal.vercel.recover, {});

export default crons;
