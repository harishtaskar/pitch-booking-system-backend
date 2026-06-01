import { Router } from "express";
import { authMiddleware } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import * as bookingController from "./booking.controller";

const router = Router();

router.post("/reserve-slot", authMiddleware, asyncHandler(bookingController.reserveSlot));
router.post("/confirm-booking", authMiddleware, asyncHandler(bookingController.confirmBooking));
router.get("/my-bookings", authMiddleware, asyncHandler(bookingController.myBookings));

export default router;
