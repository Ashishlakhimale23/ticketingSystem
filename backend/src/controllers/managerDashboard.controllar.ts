import { Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { prisma } from "../lib/database";
import { AppError } from "../middleware/errorHandler";

export const managerDashboardController = {
  async getTeam(req: AuthedRequest, res: Response) {
    const managerId = req.user!.id;
    const manager = await prisma.user.findUnique({
      where: { id: managerId },
      select: { departmentId: true, role: true },
    });

    if (!manager?.departmentId) {
      throw new AppError("You are not assigned to any department", 400);
    }

    const department = await prisma.department.findUnique({
      where: { id: manager.departmentId },
      select: { name: true },
    });

    const users = await prisma.user.findMany({
      where: {
        departmentId: manager.departmentId,
        id: { not: managerId },
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isAvailableForAssignment: true,
        _count: {
          select: {
            ticketsAssigned: {
              where: { status: { not: "RESOLVED" } },
            },
            ticketsRequested: true,
          },
        },
      },
      orderBy: { fullName: "asc" },
    });

    const usersWithTickets = await Promise.all(
      users.map(async (u) => {
        const openCount = await prisma.ticket.count({
          where: { assigneeId: u.id, status: "OPEN" },
        });
        const inProgressCount = await prisma.ticket.count({
          where: { assigneeId: u.id, status: "IN_PROGRESS" },
        });
        const resolvedCount = await prisma.ticket.count({
          where: { assigneeId: u.id, status: "RESOLVED" },
        });
        const breachedCount = await prisma.ticket.count({
          where: { assigneeId: u.id, slaBreached: true, status: { not: "RESOLVED" } },
        });

        return {
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          role: u.role,
          isAvailableForAssignment: u.isAvailableForAssignment,
          activeTickets: u._count.ticketsAssigned,
          totalRequested: u._count.ticketsRequested,
          openTickets: openCount,
          inProgressTickets: inProgressCount,
          resolvedTickets: resolvedCount,
          breachedTickets: breachedCount,
        };
      })
    );

    res.json({
      departmentId: manager.departmentId,
      departmentName: department?.name || "Unknown",
      users: usersWithTickets,
    });
  },

  async getUserTickets(req: AuthedRequest, res: Response) {
    const managerId = req.user!.id;
    const { userId } = req.params;

    const manager = await prisma.user.findUnique({
      where: { id: managerId },
      select: { departmentId: true },
    });

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { departmentId: true, fullName: true },
    });

    if (!manager?.departmentId || targetUser?.departmentId !== manager.departmentId) {
      throw new AppError("User is not in your department", 403);
    }

    const tickets = await prisma.ticket.findMany({
      where: {
        OR: [
          { assigneeId: userId },
          { requesterId: userId },
        ],
        departmentId: manager.departmentId,
      },
      include: {
        assignee: { select: { id: true, fullName: true, email: true } },
        requester: { select: { id: true, fullName: true, email: true } },
        category: { select: { name: true } },
        department: { select: { name: true } },
        comments: {
          orderBy: { createdAt: "desc" },
          take: 5,
          include: { user: { select: { fullName: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      user: { id: userId, fullName: targetUser?.fullName },
      tickets,
    });
  },

  async reassignTicket(req: AuthedRequest, res: Response) {
    const managerId = req.user!.id;
    const { ticketId, newAssigneeId } = req.body;

    if (!ticketId || !newAssigneeId) {
      throw new AppError("ticketId and newAssigneeId are required", 400);
    }

    const manager = await prisma.user.findUnique({
      where: { id: managerId },
      select: { departmentId: true },
    });

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { departmentId: true, assigneeId: true },
    });

    if (!ticket) throw new AppError("Ticket not found", 404);
    if (ticket.departmentId !== manager?.departmentId) {
      throw new AppError("Ticket is not in your department", 403);
    }

    const newAssignee = await prisma.user.findUnique({
      where: { id: newAssigneeId },
      select: { departmentId: true, isActive: true },
    });

    if (!newAssignee || !newAssignee.isActive) {
      throw new AppError("New assignee not found or inactive", 400);
    }
    if (newAssignee.departmentId !== manager?.departmentId) {
      throw new AppError("New assignee is not in your department", 400);
    }

    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        assigneeId: newAssigneeId,
        assignedById: managerId,
        assignmentMethod: "MANUAL",
        assignedAt: new Date(),
      },
      include: {
        assignee: { select: { fullName: true } },
      },
    });

    await prisma.ticketStatusHistory.create({
      data: {
        ticketId,
        fromStatus: null,
        status: updated.status,
        changedById: managerId,
        changedAt: new Date(),
        note: `Reassigned by manager to ${updated.assignee?.fullName || "another agent"}`,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: managerId,
        action: `Reassigned ticket ${updated.ticketNumber} to ${updated.assignee?.fullName || "another agent"}`,
        entityType: "Ticket",
        entityId: ticketId,
      },
    });

    res.json(updated);
  },

  async setDepartmentManager(req: AuthedRequest, res: Response) {
    const { userId } = req.body;

    if (!userId) throw new AppError("userId is required", 400);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { departmentId: true, role: true },
    });

    if (!user) throw new AppError("User not found", 404);
    if (!user.departmentId) throw new AppError("User must belong to a department first", 400);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role: "DEPT_MANAGER" },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: `Promoted user ${updated.fullName} to Department Manager`,
        entityType: "User",
        entityId: userId,
      },
    });

    res.json(updated);
  },
};
