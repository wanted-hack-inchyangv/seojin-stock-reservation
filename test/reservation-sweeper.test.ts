import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryReservationRepository } from "../src/repository/in-memory-reservation-repository.js";
import { InMemoryStockRepository } from "../src/repository/in-memory-stock-repository.js";
import { ReservationService } from "../src/service/reservation-service.js";
import { ReservationSweeper } from "../src/service/reservation-sweeper.js";

describe("ReservationSweeper", () => {
  let stockRepo: InMemoryStockRepository;
  let reservationRepo: InMemoryReservationRepository;
  let service: ReservationService;
  let sweeper: ReservationSweeper;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00+09:00"));

    stockRepo = new InMemoryStockRepository();
    reservationRepo = new InMemoryReservationRepository();
    service = new ReservationService(stockRepo, reservationRepo);
    sweeper = new ReservationSweeper(reservationRepo, service);

    await stockRepo.create("sku-1", 10);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves reservations untouched before their TTL elapses", async () => {
    const reservation = await service.reserve("sku-1", 3, 1_000);

    const sweptIds = await sweeper.sweepOnce();

    expect(sweptIds).toEqual([]);
    const stillPending = await reservationRepo.findById(reservation.id);
    expect(stillPending?.status).toBe("PENDING");
  });

  it("expires a reservation once its TTL has passed and returns the hold to available stock", async () => {
    const reservation = await service.reserve("sku-1", 3, 1_000);

    vi.advanceTimersByTime(1_500);

    const sweptIds = await sweeper.sweepOnce();

    expect(sweptIds).toEqual([reservation.id]);

    const expired = await reservationRepo.findById(reservation.id);
    expect(expired?.status).toBe("EXPIRED");

    const stock = await stockRepo.findBySku("sku-1");
    expect(stock?.reserved).toBe(0); // 선점이 회수되었다
    expect(stock?.quantity).toBe(10); // on-hand 재고는 그대로다
  });

  it("only expires reservations that are actually due, leaving others pending", async () => {
    const soonToExpire = await service.reserve("sku-1", 2, 1_000);
    const stillFresh = await service.reserve("sku-1", 2, 60_000);

    vi.advanceTimersByTime(1_500);

    const sweptIds = await sweeper.sweepOnce();

    expect(sweptIds).toEqual([soonToExpire.id]);

    const fresh = await reservationRepo.findById(stillFresh.id);
    expect(fresh?.status).toBe("PENDING");

    const stock = await stockRepo.findBySku("sku-1");
    expect(stock?.reserved).toBe(2); // stillFresh 몫만 남는다
  });

  it("is idempotent: sweeping twice does not double-release stock", async () => {
    const reservation = await service.reserve("sku-1", 4, 1_000);
    vi.advanceTimersByTime(2_000);

    await sweeper.sweepOnce();
    const secondSweep = await sweeper.sweepOnce();

    expect(secondSweep).toEqual([]); // 이미 EXPIRED 라서 대상이 아니다

    const stock = await stockRepo.findBySku("sku-1");
    expect(stock?.reserved).toBe(0);
    expect(reservation.status).toBe("PENDING"); // 최초 반환값은 예약 시점 스냅샷
  });

  it("skips a reservation that was confirmed by the user right before the sweep runs", async () => {
    const reservation = await service.reserve("sku-1", 2, 1_000);
    vi.advanceTimersByTime(500);
    await service.confirm(reservation.id); // TTL 이 지나기 전에 사용자가 확정

    vi.advanceTimersByTime(1_000); // sweep 시점에는 이미 CONFIRMED

    const sweptIds = await sweeper.sweepOnce();
    expect(sweptIds).toEqual([]);

    const stock = await stockRepo.findBySku("sku-1");
    expect(stock?.quantity).toBe(8); // confirm 으로 이미 차감됨
    expect(stock?.reserved).toBe(0);
  });
});
