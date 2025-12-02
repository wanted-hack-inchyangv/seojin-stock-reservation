import { describe, expect, it } from "vitest";
import { InsufficientStockError } from "../src/domain/types.js";
import { InMemoryReservationRepository } from "../src/repository/in-memory-reservation-repository.js";
import { InMemoryStockRepository } from "../src/repository/in-memory-stock-repository.js";
import { ReservationService } from "../src/service/reservation-service.js";

describe("concurrent reservations on a single hot SKU", () => {
  it("never oversells even under 200 simultaneous requests", async () => {
    const stockRepo = new InMemoryStockRepository();
    const reservationRepo = new InMemoryReservationRepository();
    const INITIAL_QUANTITY = 100;
    const CONCURRENT_REQUESTS = 200;

    // 모든 요청이 동일한 레코드를 두고 경쟁하는 최악의 시나리오이므로,
    // 재시도 상한을 넉넉히 잡는다 (단일 요청 기본값보다 훨씬 큰 값 -
    // 이유는 docs/adr/0001-optimistic-locking-over-pessimistic-locking.md 참고).
    const service = new ReservationService(stockRepo, reservationRepo, {
      maxRetries: CONCURRENT_REQUESTS * 2,
    });

    await stockRepo.create("hot-sku", INITIAL_QUANTITY);

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_REQUESTS }, () => service.reserve("hot-sku", 1, 60_000)),
    );

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof service.reserve>>> =>
        r.status === "fulfilled",
    );
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    // 1) 초과 판매 없음: 성공한 예약 수는 초기 재고를 절대 넘지 않는다.
    expect(fulfilled.length).toBeLessThanOrEqual(INITIAL_QUANTITY);
    // 이 시나리오(요청 200 > 재고 100)에서는 정확히 재고만큼만 성공해야 한다.
    expect(fulfilled.length).toBe(INITIAL_QUANTITY);
    expect(rejected.length).toBe(CONCURRENT_REQUESTS - INITIAL_QUANTITY);

    // 2) 실패는 전부 "재고 부족"이지, 재시도 상한 초과(ConcurrencyConflictError)가 아니어야 한다.
    for (const failure of rejected) {
      expect(failure.reason).toBeInstanceOf(InsufficientStockError);
    }

    // 3) 재고 합계 보존: reserved 는 성공한 예약 수량의 합과 정확히 같아야 하고,
    //    quantity(온핸드)는 아무도 confirm 하지 않았으므로 그대로여야 한다.
    const finalStock = await stockRepo.findBySku("hot-sku");
    expect(finalStock?.quantity).toBe(INITIAL_QUANTITY);
    expect(finalStock?.reserved).toBe(fulfilled.length);

    // 4) 각 예약 id 는 고유해야 한다 (경쟁 상황에서 레코드가 서로 덮어써지지 않았는지 확인).
    const ids = new Set(fulfilled.map((r) => r.value.id));
    expect(ids.size).toBe(fulfilled.length);
  });

  it("keeps the reservation ledger consistent when confirms and releases race with new reserves", async () => {
    const stockRepo = new InMemoryStockRepository();
    const reservationRepo = new InMemoryReservationRepository();
    const service = new ReservationService(stockRepo, reservationRepo, { maxRetries: 200 });

    await stockRepo.create("mixed-sku", 50);

    const initial = await Promise.all(
      Array.from({ length: 30 }, () => service.reserve("mixed-sku", 1, 60_000)),
    );

    const [confirmResults, releaseResults, moreReserveResults] = await Promise.all([
      Promise.allSettled(initial.slice(0, 10).map((r) => service.confirm(r.id))),
      Promise.allSettled(initial.slice(10, 20).map((r) => service.release(r.id))),
      Promise.allSettled(Array.from({ length: 40 }, () => service.reserve("mixed-sku", 1, 60_000))),
    ]);

    expect(confirmResults.every((r) => r.status === "fulfilled")).toBe(true);
    expect(releaseResults.every((r) => r.status === "fulfilled")).toBe(true);

    const succeededNewReserves = moreReserveResults.filter((r) => r.status === "fulfilled").length;

    const stock = await stockRepo.findBySku("mixed-sku");
    // 확정 10건만 on-hand 재고를 깎는다.
    expect(stock?.quantity).toBe(40); // 50 - 10
    // reserved = (남은 최초 PENDING 10건) + (새로 성공한 예약)
    expect(stock?.reserved).toBe(10 + succeededNewReserves);
    expect((stock?.quantity ?? 0) - (stock?.reserved ?? 0)).toBeGreaterThanOrEqual(0);
  });
});
