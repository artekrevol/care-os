import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import clientsRouter from "./clients";
import caregiversRouter from "./caregivers";
import schedulesRouter from "./schedules";
import visitsRouter from "./visits";
import payPeriodsRouter from "./payPeriods";
import laborRulesRouter from "./laborRules";
import alertsRouter from "./alerts";
import auditLogRouter from "./auditLog";
import reportsRouter from "./reports";
import notificationsRouter from "./notifications";
import telephonyRouter from "./telephony";
import carePlansRouter from "./carePlans";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(clientsRouter);
router.use(caregiversRouter);
router.use(schedulesRouter);
router.use(visitsRouter);
router.use(payPeriodsRouter);
router.use(laborRulesRouter);
router.use(alertsRouter);
router.use(auditLogRouter);
router.use(reportsRouter);
router.use(notificationsRouter);
router.use(telephonyRouter);
router.use(carePlansRouter);

export default router;
