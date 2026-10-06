import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { createReturn } from "./commerce/returns.js";
import { createSale } from "./commerce/sales.js";
import type { DbPool } from "./db.js";
import { AppError } from "./errors.js";

const uuid = z.string().uuid();
const occurredAt = z.string().datetime({ offset: true });

const saleSchema = z.object({
  businessId: uuid,
  branchId: uuid,
  clientMutationId: z.string().min(1).max(200),
  currencyCode: z.string().length(3).transform((value) => value.toUpperCase()),
  customerId: uuid.optional(),
  cashierStaffId: uuid.optional(),
  occurredAt,
  lines: z.array(z.object({
    itemId: uuid,
    quantity: z.number().positive().finite(),
    saleUnitCode: z.string().min(1).max(40),
  })).min(1),
  payments: z.array(z.object({
    clientMutationId: z.string().min(1).max(200),
    method: z.enum(["CASH", "MOMO", "CARD", "BANK", "CUSTOMER_CREDIT", "OTHER"]),
    amountMinor: z.number().int().positive().safe(),
    providerReference: z.string().max(250).optional(),
  })).min(1),
});

const returnSchema = z.object({
  businessId: uuid,
  branchId: uuid,
  originalSaleId: uuid,
  clientMutationId: z.string().min(1).max(200),
  initiatedByStaffId: uuid.optional(),
  approvedByStaffId: uuid.optional(),
  reason: z.string().trim().min(1).max(1000),
  refundMethod: z.enum(["CASH", "MOMO", "CARD", "BANK", "CUSTOMER_CREDIT", "ORIGINAL_METHOD"]),
  occurredAt,
  lines: z.array(z.object({
    saleLineId: uuid,
    quantity: z.number().positive().finite(),
    disposition: z.enum(["RESTOCK", "QUARANTINE", "DISCARD", "NOT_APPLICABLE"]),
  })).min(1),
});

export interface BuildAppOptions {
  pool: DbPool;
  webOrigin: string;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: options.webOrigin,
    credentials: true,
  });

  app.get("/health", async () => {
    await options.pool.query("SELECT 1");
    return { status: "ok", service: "tradeos-api" };
  });

  app.post("/v1/sales", async (request, reply) => {
    const body = saleSchema.parse(request.body);
    const result = await createSale(options.pool, {
      businessId: body.businessId,
      branchId: body.branchId,
      clientMutationId: body.clientMutationId,
      currencyCode: body.currencyCode,
      occurredAt: body.occurredAt,
      lines: body.lines,
      payments: body.payments.map((payment) => ({
        clientMutationId: payment.clientMutationId,
        method: payment.method,
        amountMinor: payment.amountMinor,
        ...(payment.providerReference ? { providerReference: payment.providerReference } : {}),
      })),
      ...(body.customerId ? { customerId: body.customerId } : {}),
      ...(body.cashierStaffId ? { cashierStaffId: body.cashierStaffId } : {}),
    });
    return reply.code(result.idempotentReplay ? 200 : 201).send(result);
  });

  app.post("/v1/returns", async (request, reply) => {
    const body = returnSchema.parse(request.body);
    const result = await createReturn(options.pool, {
      businessId: body.businessId,
      branchId: body.branchId,
      originalSaleId: body.originalSaleId,
      clientMutationId: body.clientMutationId,
      reason: body.reason,
      refundMethod: body.refundMethod,
      occurredAt: body.occurredAt,
      lines: body.lines,
      ...(body.initiatedByStaffId ? { initiatedByStaffId: body.initiatedByStaffId } : {}),
      ...(body.approvedByStaffId ? { approvedByStaffId: body.approvedByStaffId } : {}),
    });
    return reply.code(result.idempotentReplay ? 200 : 201).send(result);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: "Request validation failed",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    }

    app.log.error(error);
    return reply.code(500).send({
      error: "INTERNAL_ERROR",
      message: "An unexpected server error occurred",
    });
  });

  return app;
}
