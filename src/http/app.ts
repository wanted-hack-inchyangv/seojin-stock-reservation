import { Hono } from "hono";
import { availableQuantity } from "../domain/types.js";
import type { StockRepository } from "../repository/stock-repository.js";
import type { ReservationService } from "../service/reservation-service.js";
import { toErrorResponse } from "./errors.js";
import { createStockSchema, reserveSchema } from "./schemas.js";
import type { ReservationRepository } from "../repository/reservation-repository.js";

export interface AppDependencies {
  readonly stockRepo: StockRepository;
  readonly reservationRepo: ReservationRepository;
  readonly service: ReservationService;
}

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post("/stocks", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = createStockSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "InvalidRequest", details: parsed.error.flatten() }, 400);
    }
    const stock = await deps.stockRepo.create(parsed.data.sku, parsed.data.quantity);
    return c.json({ ...stock, available: availableQuantity(stock) }, 201);
  });

  app.get("/stocks/:sku", async (c) => {
    const stock = await deps.stockRepo.findBySku(c.req.param("sku"));
    if (!stock) {
      return c.json({ error: "StockNotFoundError", message: "stock not found" }, 404);
    }
    return c.json({ ...stock, available: availableQuantity(stock) });
  });

  app.post("/reservations", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = reserveSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "InvalidRequest", details: parsed.error.flatten() }, 400);
    }
    try {
      const reservation = await deps.service.reserve(
        parsed.data.sku,
        parsed.data.quantity,
        parsed.data.ttlMs,
      );
      return c.json(reservation, 201);
    } catch (error) {
      const { status, body: errorBody } = toErrorResponse(error);
      return c.json(errorBody, status as 400 | 404 | 409 | 410 | 500);
    }
  });

  app.get("/reservations/:id", async (c) => {
    const reservation = await deps.reservationRepo.findById(c.req.param("id"));
    if (!reservation) {
      return c.json({ error: "ReservationNotFoundError", message: "reservation not found" }, 404);
    }
    return c.json(reservation);
  });

  app.post("/reservations/:id/confirm", async (c) => {
    try {
      const reservation = await deps.service.confirm(c.req.param("id"));
      return c.json(reservation);
    } catch (error) {
      const { status, body: errorBody } = toErrorResponse(error);
      return c.json(errorBody, status as 400 | 404 | 409 | 410 | 500);
    }
  });

  app.post("/reservations/:id/release", async (c) => {
    try {
      const reservation = await deps.service.release(c.req.param("id"));
      return c.json(reservation);
    } catch (error) {
      const { status, body: errorBody } = toErrorResponse(error);
      return c.json(errorBody, status as 400 | 404 | 409 | 410 | 500);
    }
  });

  return app;
}
