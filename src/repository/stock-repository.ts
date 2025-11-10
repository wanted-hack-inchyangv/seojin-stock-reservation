import type { StockRecord } from "../domain/types.js";

export interface UpdateOptions {
  /** version 충돌 시 재시도할 최대 횟수 (첫 시도 포함하지 않음). */
  readonly maxRetries?: number;
}

/**
 * 재고 저장소 인터페이스.
 *
 * update() 는 낙관적 잠금(compare-and-set)을 구현한다. updater 는 현재
 * 레코드를 받아 다음 상태를 반환하며, 그 사이 다른 트랜잭션이 먼저 쓰면
 * version 을 다시 읽어 updater 를 재적용한다. updater 안에서 던진 예외
 * (재고 부족 등 업무 규칙 위반)는 재시도하지 않고 즉시 호출자에게 전파된다.
 */
export interface StockRepository {
  create(sku: string, quantity: number): Promise<StockRecord>;
  findBySku(sku: string): Promise<StockRecord | undefined>;
  update(
    sku: string,
    updater: (current: StockRecord) => Pick<StockRecord, "quantity" | "reserved">,
    options?: UpdateOptions,
  ): Promise<StockRecord>;
}
