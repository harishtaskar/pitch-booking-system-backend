import cors from "cors";
import express from "express";
import { isAllowedOrigin } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import authRoutes from "./modules/auth/auth.routes";
import bookingRoutes from "./modules/booking/booking.routes";
import pitchRoutes from "./modules/pitch/pitch.routes";
import slotRoutes from "./modules/slot/slot.routes";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: (origin, callback) =>
        isAllowedOrigin(origin)
          ? callback(null, true)
          : callback(new Error(`Origin not allowed by CORS: ${origin}`)),
      credentials: true,
    })
  );
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/auth", authRoutes);
  app.use("/pitches", pitchRoutes);
  app.use("/slots", slotRoutes);
  // reserve-slot, confirm-booking, my-bookings live at the root per the spec
  app.use("/", bookingRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
