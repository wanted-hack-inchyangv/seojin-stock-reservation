import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { InMemoryReservationRepository } from "../src/repository/in-memory-reservation-repository.js";
import { InMemoryStockRepository } from "../src/repository/in-memory-stock-repository.js";
import { ReservationService } from "../src/service/reservation-service.js";
import type { Hono } from "hono";

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

describe("HTTP API", () => {
  let app: Hono;

  beforeEach(() => {
    const stockRepo = new InMemoryStockRepository();
    const reservationRepo = new InMemoryReservationRepository();
    const service = new ReservationService(stockRepo, reservationRepo);
    app = createApp({ stockRepo, reservationRepo, service });
  });

  it("reports ok on the health check", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ status: "ok" });
  });

  it("creates and reads back a stock record", async () => {
    const createRes = await app.request("/stocks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "sku-1", quantity: 10 }),
    });
    expect(createRes.status).toBe(201);
    expect(await json(createRes)).toMatchObject({ sku: "sku-1", quantity: 10, available: 10 });

    const getRes = await app.request("/stocks/sku-1");
    expect(getRes.status).toBe(200);
    expect(await json(getRes)).toMatchObject({ sku: "sku-1", quantity: 10, available: 10 });
  });

  it("returns 404 for an unknown stock", async () => {
    const res = await app.request("/stocks/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid stock payload", async () => {
    const res = await app.request("/stocks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "", quantity: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it("walks through reserve -> confirm", async () => {
    await app.request("/stocks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "sku-1", quantity: 5 }),
    });

    const reserveRes = await app.request("/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "sku-1", quantity: 2, ttlMs: 60_000 }),
    });
    expect(reserveRes.status).toBe(201);
    const reservation = await json(reserveRes);
    expect(reservation.status).toBe("PENDING");

    const getRes = await app.request(`/reservations/${reservation.id as string}`);
    expect(getRes.status).toBe(200);

    const confirmRes = await app.request(`/reservations/${reservation.id as string}/confirm`, {
      method: "POST",
    });
    expect(confirmRes.status).toBe(200);
    expect(await json(confirmRes)).toMatchObject({ status: "CONFIRMED" });

    const stockRes = await app.request("/stocks/sku-1");
    expect(await json(stockRes)).toMatchObject({ quantity: 3, reserved: 0, available: 3 });
  });

  it("walks through reserve -> release", async () => {
    await app.request("/stocks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "sku-1", quantity: 5 }),
    });

    const reserveRes = await app.request("/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "sku-1", quantity: 2 }),
    });
    const reservation = await json(reserveRes);

    const releaseRes = await app.request(`/reservations/${reservation.id as string}/release`, {
      method: "POST",
    });
    expect(releaseRes.status).toBe(200);
    expect(await json(releaseRes)).toMatchObject({ status: "RELEASED" });

    const stockRes = await app.request("/stocks/sku-1");
    expect(await json(stockRes)).toMatchObject({ quantity: 5, reserved: 0, available: 5 });
  });

  it("returns 409 when reserving more than available", async () => {
    await app.request("/stocks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "sku-1", quantity: 1 }),
    });

    const res = await app.request("/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "sku-1", quantity: 5 }),
    });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("InsufficientStockError");
  });

  it("returns 404 when confirming an unknown reservation", async () => {
    const res = await app.request("/reservations/does-not-exist/confirm", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
