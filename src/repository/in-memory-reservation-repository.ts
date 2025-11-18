import {
  ConcurrencyConflictError,
  ReservationNotFoundError,
} from "../domain/types.js";
import type { ReservationRecord, ReservationStatus } from "../domain/types.js";
import { ioGap } from "./async-gap.js";
import type {
  NewReservationInput,
  ReservationRepository,
} from "./reservation-repository.js";
import type { UpdateOptions } from "./stock-repository.js";

const DEFAULT_MAX_RETRIES = 16;

export class InMemoryReservationRepository implements ReservationRepository {
  private readonly store = new Map<string, ReservationRecord>();

  async create(input: NewReservationInput): Promise<ReservationRecord> {
    await ioGap();
    const record: ReservationRecord = {
      id: input.id,
      sku: input.sku,
      quantity: input.quantity,
      status: "PENDING",
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      version: 0,
    };
    this.store.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<ReservationRecord | undefined> {
    await ioGap();
    return this.store.get(id);
  }

  async listExpiredPending(asOf: number): Promise<ReservationRecord[]> {
    await ioGap();
    const result: ReservationRecord[] = [];
    for (const record of this.store.values()) {
      if (record.status === "PENDING" && record.expiresAt <= asOf) {
        result.push(record);
      }
    }
    return result;
  }

  async update(
    id: string,
    updater: (current: ReservationRecord) => ReservationStatus,
    options?: UpdateOptions,
  ): Promise<ReservationRecord> {
    const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await ioGap();
      const current = this.store.get(id);
      if (!current) {
        throw new ReservationNotFoundError(id);
      }

      const nextStatus = updater(current);
      const next: ReservationRecord = {
        ...current,
        status: nextStatus,
        version: current.version + 1,
      };

      await ioGap();
      const stillLatest = this.store.get(id);
      if (!stillLatest || stillLatest.version !== current.version) {
        continue;
      }

      this.store.set(id, next);
      return next;
    }

    throw new ConcurrencyConflictError(
      `failed to update reservation ${id} after ${maxRetries} retries due to version conflicts`,
    );
  }
}
