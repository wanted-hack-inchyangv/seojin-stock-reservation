import {
  ConcurrencyConflictError,
  InsufficientStockError,
  InvalidReservationStateError,
  ReservationExpiredError,
  ReservationNotFoundError,
  StockNotFoundError,
} from "../domain/types.js";

export interface ErrorResponse {
  readonly status: number;
  readonly body: { error: string; message: string };
}

/** 도메인 예외를 HTTP 상태 코드로 변환한다. */
export function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof StockNotFoundError || error instanceof ReservationNotFoundError) {
    return { status: 404, body: { error: error.name, message: error.message } };
  }
  if (error instanceof InsufficientStockError) {
    return { status: 409, body: { error: error.name, message: error.message } };
  }
  if (error instanceof ConcurrencyConflictError) {
    return { status: 409, body: { error: error.name, message: error.message } };
  }
  if (error instanceof InvalidReservationStateError) {
    return { status: 409, body: { error: error.name, message: error.message } };
  }
  if (error instanceof ReservationExpiredError) {
    return { status: 410, body: { error: error.name, message: error.message } };
  }
  if (error instanceof RangeError) {
    return { status: 400, body: { error: "InvalidRequest", message: error.message } };
  }

  return {
    status: 500,
    body: { error: "InternalError", message: "unexpected server error" },
  };
}
