import { Router, type IRouter } from "express";
import authRouter from "./auth";
import scheduleRouter from "./schedule";
import visitsRouter from "./visits";
import transcribeRouter from "./transcribe";

const router: IRouter = Router();
router.use(authRouter);
router.use(scheduleRouter);
router.use(visitsRouter);
router.use(transcribeRouter);
export default router;
