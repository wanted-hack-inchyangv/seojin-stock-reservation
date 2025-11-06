/**
 * 재고 레코드.
 *
 * quantity: 창고에 실제로 존재하는 수량(확정 판매 시 감소).
 * reserved: 만료되지 않은 PENDING 예약이 붙잡고 있는 수량.
 * available = quantity - reserved 는 항상 저장하지 않고 계산으로 유도한다.
 * version 은 compare-and-set 에 사용하는 낙관적 잠금 카운터다.
 */
export interface StockRecord {
  readonly sku: string;
  readonly quantity: number;
  readonly reserved: number;
  readonly version: number;
}

export type ReservationStatus =
  | "PENDING"
  | "CONFIRMED"
  | "RELEASED"
  | "EXPIRED";

export interface ReservationRecord {
  readonly id: string;
  readonly sku: string;
  readonly quantity: number;
  readonly status: ReservationStatus;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly version: number;
}

export function availableQuantity(stock: StockRecord): number {
  return stock.quantity - stock.reserved;
}

export class ConcurrencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyConflictError";
  }
}

export class InsufficientStockError extends Error {
  constructor(sku: string, requested: number, available: number) {
    super(
      `insufficient stock for sku=${sku}: requested=${requested}, available=${available}`,
    );
    this.name = "InsufficientStockError";
  }
}

export class StockNotFoundError extends Error {
  constructor(sku: string) {
    super(`stock not found for sku=${sku}`);
    this.name = "StockNotFoundError";
  }
}

export class ReservationNotFoundError extends Error {
  constructor(id: string) {
    super(`reservation not found: ${id}`);
    this.name = "ReservationNotFoundError";
  }
}

export class InvalidReservationStateError extends Error {
  constructor(id: string, status: ReservationStatus, action: string) {
    super(`cannot ${action} reservation ${id} in status ${status}`);
    this.name = "InvalidReservationStateError";
  }
}

export class ReservationExpiredError extends Error {
  constructor(id: string) {
    super(`reservation ${id} has already expired`);
    this.name = "ReservationExpiredError";
  }
}
