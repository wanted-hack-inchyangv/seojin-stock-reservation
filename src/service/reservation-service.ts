import { randomUUID } from "node:crypto";
import {
  InsufficientStockError,
  InvalidReservationStateError,
  ReservationExpiredError,
  ReservationNotFoundError,
  availableQuantity,
} from "../domain/types.js";
import type { ReservationRecord } from "../domain/types.js";
import type { ReservationRepository } from "../repository/reservation-repository.js";
import type { StockRepository, UpdateOptions } from "../repository/stock-repository.js";

export interface ReservationServiceOptions {
  /** 예약 요청에 ttlMs 를 지정하지 않았을 때 사용하는 기본 TTL. */
  readonly defaultTtlMs?: number;
  /** 재고/예약 CAS 갱신 재시도 상한. 핫 SKU 부하 테스트에서는 늘려서 사용한다. */
  readonly maxRetries?: number;
  readonly now?: () => number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5분

export class ReservationService {
  private readonly defaultTtlMs: number;
  private readonly updateOptions: UpdateOptions;
  private readonly now: () => number;

  constructor(
    private readonly stockRepo: StockRepository,
    private readonly reservationRepo: ReservationRepository,
    options: ReservationServiceOptions = {},
  ) {
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.updateOptions = options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries };
    this.now = options.now ?? Date.now;
  }

  /**
   * 재고를 선점한다. quantity 만큼 available 이 있어야 성공하며, 성공하면
   * stock.reserved 가 즉시 증가하고 PENDING 상태의 예약 레코드가 생성된다.
   */
  async reserve(sku: string, quantity: number, ttlMs?: number): Promise<ReservationRecord> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new RangeError("quantity must be a positive integer");
    }
    const effectiveTtlMs = ttlMs ?? this.defaultTtlMs;
    if (!Number.isInteger(effectiveTtlMs) || effectiveTtlMs <= 0) {
      throw new RangeError("ttlMs must be a positive integer");
    }

    await this.stockRepo.update(
      sku,
      (stock) => {
        const avail = availableQuantity(stock);
        if (avail < quantity) {
          // repository.update() 는 updater 가 던진 예외를 재시도하지 않고
          // 그대로 호출자에게 전파한다 (버전 충돌과는 다른 경로).
          throw new InsufficientStockError(sku, quantity, avail);
        }
        return { quantity: stock.quantity, reserved: stock.reserved + quantity };
      },
      this.updateOptions,
    );

    const createdAt = this.now();
    return this.reservationRepo.create({
      id: randomUUID(),
      sku,
      quantity,
      createdAt,
      expiresAt: createdAt + effectiveTtlMs,
    });
  }

  /** PENDING 예약을 확정 판매로 전환한다. 재고 원장에서 quantity 를 차감한다. */
  async confirm(reservationId: string): Promise<ReservationRecord> {
    const target = await this.requirePending(reservationId, "confirm");

    const confirmed = await this.reservationRepo.update(
      reservationId,
      (current) => {
        this.assertStillConfirmable(current);
        return "CONFIRMED";
      },
      this.updateOptions,
    );

    await this.stockRepo.update(
      target.sku,
      (stock) => ({
        quantity: stock.quantity - target.quantity,
        reserved: stock.reserved - target.quantity,
      }),
      this.updateOptions,
    );

    return confirmed;
  }

  /** PENDING 예약을 사용자가 직접 취소한다. reserved 만 되돌리고 quantity 는 그대로다. */
  async release(reservationId: string): Promise<ReservationRecord> {
    const target = await this.requirePending(reservationId, "release");

    const released = await this.reservationRepo.update(
      reservationId,
      (current) => {
        if (current.status !== "PENDING") {
          throw new InvalidReservationStateError(reservationId, current.status, "release");
        }
        return "RELEASED";
      },
      this.updateOptions,
    );

    await this.stockRepo.update(
      target.sku,
      (stock) => ({
        quantity: stock.quantity,
        reserved: stock.reserved - target.quantity,
      }),
      this.updateOptions,
    );

    return released;
  }

  /** sweeper 전용: TTL 이 지난 PENDING 예약을 EXPIRED 로 전환하고 재고를 회수한다. */
  async expire(reservationId: string): Promise<ReservationRecord> {
    const target = await this.reservationRepo.findById(reservationId);
    if (!target) {
      throw new ReservationNotFoundError(reservationId);
    }

    const expired = await this.reservationRepo.update(
      reservationId,
      (current) => {
        if (current.status !== "PENDING") {
          throw new InvalidReservationStateError(reservationId, current.status, "expire");
        }
        return "EXPIRED";
      },
      this.updateOptions,
    );

    await this.stockRepo.update(
      target.sku,
      (stock) => ({
        quantity: stock.quantity,
        reserved: stock.reserved - target.quantity,
      }),
      this.updateOptions,
    );

    return expired;
  }

  private async requirePending(reservationId: string, action: string): Promise<ReservationRecord> {
    const current = await this.reservationRepo.findById(reservationId);
    if (!current) {
      throw new ReservationNotFoundError(reservationId);
    }
    if (current.status !== "PENDING") {
      throw new InvalidReservationStateError(reservationId, current.status, action);
    }
    if (current.expiresAt <= this.now()) {
      throw new ReservationExpiredError(reservationId);
    }
    return current;
  }

  private assertStillConfirmable(current: ReservationRecord): void {
    if (current.status !== "PENDING") {
      throw new InvalidReservationStateError(current.id, current.status, "confirm");
    }
    if (current.expiresAt <= this.now()) {
      throw new ReservationExpiredError(current.id);
    }
  }
}
