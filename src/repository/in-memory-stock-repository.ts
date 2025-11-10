import { ConcurrencyConflictError, StockNotFoundError } from "../domain/types.js";
import type { StockRecord } from "../domain/types.js";
import { ioGap } from "./async-gap.js";
import type { StockRepository, UpdateOptions } from "./stock-repository.js";

const DEFAULT_MAX_RETRIES = 64;

export class InMemoryStockRepository implements StockRepository {
  private readonly store = new Map<string, StockRecord>();

  async create(sku: string, quantity: number): Promise<StockRecord> {
    await ioGap();
    const record: StockRecord = { sku, quantity, reserved: 0, version: 0 };
    this.store.set(sku, record);
    return record;
  }

  async findBySku(sku: string): Promise<StockRecord | undefined> {
    await ioGap();
    return this.store.get(sku);
  }

  async update(
    sku: string,
    updater: (current: StockRecord) => Pick<StockRecord, "quantity" | "reserved">,
    options?: UpdateOptions,
  ): Promise<StockRecord> {
    const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await ioGap(); // read latency
      const current = this.store.get(sku);
      if (!current) {
        throw new StockNotFoundError(sku);
      }

      // updater 가 던지는 업무 규칙 예외(재고 부족 등)는 그대로 전파한다.
      const patch = updater(current);
      const next: StockRecord = {
        sku,
        quantity: patch.quantity,
        reserved: patch.reserved,
        version: current.version + 1,
      };

      await ioGap(); // write latency: 이 틈에 다른 트랜잭션이 먼저 쓸 수 있다
      const stillLatest = this.store.get(sku);
      if (!stillLatest || stillLatest.version !== current.version) {
        // 누군가 먼저 썼다 -> 재시도
        continue;
      }

      this.store.set(sku, next);
      return next;
    }

    throw new ConcurrencyConflictError(
      `failed to update stock ${sku} after ${maxRetries} retries due to version conflicts`,
    );
  }
}
