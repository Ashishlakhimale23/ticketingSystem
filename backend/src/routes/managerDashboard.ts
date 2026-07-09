import { Router } from "express";
import { UserRole } from "../generated/prisma/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { managerDashboardController } from "../controllers/managerDashboard.controller";

export const managerDashboardRouter = Router();

managerDashboardRouter.use(requireAuth);

managerDashboardRouter.get(
  "/team",
  requireRole(UserRole.DEPT_MANAGER, UserRole.MANAGER, UserRole.GLOBAL_ADMIN, UserRole.DEPT_ADMIN),
  managerDashboardController.getTeam
);

managerDashboardRouter.get(
  "/user/:userId/tickets",
  requireRole(UserRole.DEPT_MANAGER, UserRole.MANAGER, UserRole.GLOBAL_ADMIN, UserRole.DEPT_ADMIN),
  managerDashboardController.getUserTickets
);

managerDashboardRouter.post(
  "/reassign",
  requireRole(UserRole.DEPT_MANAGER, UserRole.MANAGER, UserRole.GLOBAL_ADMIN, UserRole.DEPT_ADMIN),
  managerDashboardController.reassignTicket
);

managerDashboardRouter.post(
  "/set-manager",
  requireRole(UserRole.GLOBAL_ADMIN),
  managerDashboardController.setDepartmentManager
);
