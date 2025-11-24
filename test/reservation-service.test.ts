import { beforeEach, describe, expect, it } from "vitest";
import {
  InsufficientStockError,
  InvalidReservationStateError,
  ReservationExpiredError,
  ReservationNotFoundError,
} from "../src/domain/types.js";
import { InMemoryReservationRepository } from "../src/repository/in-memory-reservation-repository.js";
import { InMemoryStockRepository } from "../src/repository/in-memory-stock-repository.js";
import { ReservationService } from "../src/service/reservation-service.js";

describe("ReservationService", () => {
  let stockRepo: InMemoryStockRepository;
  let reservationRepo: InMemoryReservationRepository;
  let service: ReservationService;

  beforeEach(async () => {
    stockRepo = new InMemoryStockRepository();
    reservationRepo = new InMemoryReservationRepository();
    service = new ReservationService(stockRepo, reservationRepo);
    await stockRepo.create("sku-1", 5);
  });

  it("reserves stock and creates a PENDING reservation", async () => {
    const reservation = await service.reserve("sku-1", 2, 60_000);

    expect(reservation.status).toBe("PENDING");
    expect(reservation.sku).toBe("sku-1");
    expect(reservation.quantity).toBe(2);

    const stock = await stockRepo.findBySku("sku-1");
    expect(stock?.reserved).toBe(2);
    expect(stock?.quantity).toBe(5);
  });

  it("rejects a reservation that exceeds available stock", async () => {
    await service.reserve("sku-1", 4, 60_000);

    await expect(service.reserve("sku-1", 2, 60_000)).rejects.toThrow(InsufficientStockError);

    const stock = await stockRepo.findBySku("sku-1");
    expect(stock?.reserved).toBe(4); // 실패한 요청은 재고를 건드리지 않는다
  });

  it("rejects a non-positive quantity", async () => {
    await expect(service.reserve("sku-1", 0, 60_000)).rejects.toThrow(RangeError);
    await expect(service.reserve("sku-1", -1, 60_000)).rejects.toThrow(RangeError);
  });

  it("confirms a pending reservation and deducts on-hand quantity", async () => {
    const reservation = await service.reserve("sku-1", 2, 60_000);
    const confirmed = await service.confirm(reservation.id);

    expect(confirmed.status).toBe("CONFIRMED");

    const stock = await stockRepo.findBySku("sku-1");
    expect(stock?.quantity).toBe(3); // 5 - 2
    expect(stock?.reserved).toBe(0); // 확정되면서 hold 는 해제된다
  });

  it("releases a pending reservation and restores availability without touching on-hand quantity", async () => {
    const reservation = await service.reserve("sku-1", 2, 60_000);
    const released = await service.release(reservation.id);

    expect(released.status).toBe("RELEASED");

    const stock = await stockRepo.findBySku("sku-1");
    expect(stock?.quantity).toBe(5);
    expect(stock?.reserved).toBe(0);
  });

  it("throws ReservationNotFoundError for an unknown id", async () => {
    await expect(service.confirm("does-not-exist")).rejects.toThrow(ReservationNotFoundError);
    await expect(service.release("does-not-exist")).rejects.toThrow(ReservationNotFoundError);
  });

  it("refuses to confirm the same reservation twice", async () => {
    const reservation = await service.reserve("sku-1", 1, 60_000);
    await service.confirm(reservation.id);

    await expect(service.confirm(reservation.id)).rejects.toThrow(InvalidReservationStateError);
  });

  it("refuses to release an already confirmed reservation", async () => {
    const reservation = await service.reserve("sku-1", 1, 60_000);
    await service.confirm(reservation.id);

    await expect(service.release(reservation.id)).rejects.toThrow(InvalidReservationStateError);
  });

  it("refuses to confirm a reservation past its TTL", async () => {
    let now = Date.parse("2026-01-01T00:00:00+09:00");
    const timedService = new ReservationService(stockRepo, reservationRepo, {
      now: () => now,
    });

    const reservation = await timedService.reserve("sku-1", 1, 1_000);
    now += 5_000; // TTL 을 넘겨서 시간을 흘려보낸다

    await expect(timedService.confirm(reservation.id)).rejects.toThrow(ReservationExpiredError);
  });
});
