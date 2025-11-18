import type { ReservationRecord, ReservationStatus } from "../domain/types.js";
import type { UpdateOptions } from "./stock-repository.js";

export interface NewReservationInput {
  readonly id: string;
  readonly sku: string;
  readonly quantity: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ReservationRepository {
  create(input: NewReservationInput): Promise<ReservationRecord>;
  findById(id: string): Promise<ReservationRecord | undefined>;
  /** status 가 PENDING 이고 expiresAt <= asOf 인 예약을 모두 반환한다. */
  listExpiredPending(asOf: number): Promise<ReservationRecord[]>;
  update(
    id: string,
    updater: (current: ReservationRecord) => ReservationStatus,
    options?: UpdateOptions,
  ): Promise<ReservationRecord>;
}
