import { describe, expect, it, vi } from "vitest";
import { ConcurrencyConflictError, StockNotFoundError } from "../src/domain/types.js";
import { InMemoryStockRepository } from "../src/repository/in-memory-stock-repository.js";

describe("InMemoryStockRepository", () => {
  it("creates a stock record with version 0", async () => {
    const repo = new InMemoryStockRepository();
    const stock = await repo.create("sku-1", 10);
    expect(stock).toEqual({ sku: "sku-1", quantity: 10, reserved: 0, version: 0 });
  });

  it("returns undefined for an unknown sku", async () => {
    const repo = new InMemoryStockRepository();
    await expect(repo.findBySku("missing")).resolves.toBeUndefined();
  });

  it("applies updater and bumps the version on success", async () => {
    const repo = new InMemoryStockRepository();
    await repo.create("sku-1", 10);

    const updated = await repo.update("sku-1", (current) => ({
      quantity: current.quantity,
      reserved: current.reserved + 3,
    }));

    expect(updated).toEqual({ sku: "sku-1", quantity: 10, reserved: 3, version: 1 });
  });

  it("throws StockNotFoundError when updating a missing sku", async () => {
    const repo = new InMemoryStockRepository();
    await expect(
      repo.update("missing", (current) => ({ quantity: current.quantity, reserved: 0 })),
    ).rejects.toThrow(StockNotFoundError);
  });

  it("propagates a business error from the updater without retrying", async () => {
    const repo = new InMemoryStockRepository();
    await repo.create("sku-1", 10);
    const updater = vi.fn(() => {
      throw new RangeError("business rule violated");
    });

    await expect(repo.update("sku-1", updater)).rejects.toThrow(RangeError);
    expect(updater).toHaveBeenCalledTimes(1);
  });

  it("retries transparently on a version conflict and eventually succeeds", async () => {
    const repo = new InMemoryStockRepository();
    await repo.create("sku-1", 10);

    // 두 갱신을 동시에 시작한다. 인메모리 저장소는 read/write 사이에 인위적인
    // 틈을 두므로, 두 호출이 서로 버전을 두고 경쟁하게 된다.
    const [a, b] = await Promise.all([
      repo.update("sku-1", (current) => ({ quantity: current.quantity, reserved: current.reserved + 1 })),
      repo.update("sku-1", (current) => ({ quantity: current.quantity, reserved: current.reserved + 1 })),
    ]);

    // 하나는 version 1, 다른 하나는 재시도를 거쳐 version 2 에 도달해야 한다.
    const versions = [a.version, b.version].sort();
    expect(versions).toEqual([1, 2]);

    const final = await repo.findBySku("sku-1");
    expect(final?.reserved).toBe(2);
  });

  it("throws ConcurrencyConflictError when maxRetries is exhausted under contention", async () => {
    const repo = new InMemoryStockRepository();
    await repo.create("sku-1", 10);

    const results = await Promise.allSettled([
      repo.update(
        "sku-1",
        (current) => ({ quantity: current.quantity, reserved: current.reserved + 1 }),
        { maxRetries: 0 },
      ),
      repo.update(
        "sku-1",
        (current) => ({ quantity: current.quantity, reserved: current.reserved + 1 }),
        { maxRetries: 0 },
      ),
    ]);

    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflictError);
  });
});
