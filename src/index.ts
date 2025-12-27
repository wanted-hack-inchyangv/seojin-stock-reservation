import { serve } from "@hono/node-server";
import { createApp } from "./http/app.js";
import { InMemoryReservationRepository } from "./repository/in-memory-reservation-repository.js";
import { InMemoryStockRepository } from "./repository/in-memory-stock-repository.js";
import { ReservationService } from "./service/reservation-service.js";
import { ReservationSweeper } from "./service/reservation-sweeper.js";

const stockRepo = new InMemoryStockRepository();
const reservationRepo = new InMemoryReservationRepository();
const service = new ReservationService(stockRepo, reservationRepo);
const sweeper = new ReservationSweeper(reservationRepo, service, { intervalMs: 30_000 });
sweeper.start();

const app = createApp({ stockRepo, reservationRepo, service });

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`seojin-stock-reservation listening on http://localhost:${info.port}`);
});

function shutdown(): void {
  sweeper.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
