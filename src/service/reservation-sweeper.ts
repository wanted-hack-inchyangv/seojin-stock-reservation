import { InvalidReservationStateError, ReservationNotFoundError } from "../domain/types.js";
import type { ReservationRepository } from "../repository/reservation-repository.js";
import type { ReservationService } from "./reservation-service.js";

export interface ReservationSweeperOptions {
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_INTERVAL_MS = 30_000;

/**
 * TTL 이 지났지만 아무도 confirm/release 하지 않은 PENDING 예약을 주기적으로
 * 회수한다. sweep 은 멱등적이다 - 이미 다른 경로로 상태가 바뀐 예약을 만나면
 * (사용자가 그 사이 confirm 했다든지) 조용히 건너뛴다.
 */
export class ReservationSweeper {
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly onError: (error: unknown) => void;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly reservationRepo: ReservationRepository,
    private readonly service: ReservationService,
    options: ReservationSweeperOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => undefined);
  }

  /** 한 번 스윕하고 실제로 만료 처리한 예약 id 목록을 반환한다. */
  async sweepOnce(): Promise<string[]> {
    const targets = await this.reservationRepo.listExpiredPending(this.now());
    const expiredIds: string[] = [];

    for (const target of targets) {
      try {
        await this.service.expire(target.id);
        expiredIds.push(target.id);
      } catch (error) {
        // 다른 경로(사용자의 confirm/release, 또는 동시 sweep)로 이미 상태가
        // 바뀐 경우는 정상적인 레이스이므로 무시하고 계속 진행한다.
        if (
          error instanceof InvalidReservationStateError ||
          error instanceof ReservationNotFoundError
        ) {
          continue;
        }
        throw error;
      }
    }

    return expiredIds;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.sweepOnce().catch(this.onError);
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
