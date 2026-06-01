import { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../../utils/httpError";
import * as bookingService from "./booking.service";

const slotActionSchema = z.object({
  pitchId: z.string().min(1),
  slotId: z.string().min(1),
  date: z.string().min(1),
  tz: z.string().optional(), // IANA timezone, e.g. "Asia/Kolkata"
});

function requireUserId(req: Request): string {
  if (!req.user) throw new HttpError(401, "Unauthenticated");
  return req.user.id;
}

export async function reserveSlot(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { pitchId, slotId, date, tz } = slotActionSchema.parse(req.body);
  const result = await bookingService.reserveSlot(userId, pitchId, slotId, date, tz);
  res.status(200).json(result);
}

export async function confirmBooking(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { pitchId, slotId, date, tz } = slotActionSchema.parse(req.body);
  const booking = await bookingService.confirmBooking(userId, pitchId, slotId, date, tz);
  res.status(201).json(booking);
}

export async function releaseSlot(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { pitchId, slotId, date } = slotActionSchema.parse(req.body);
  const result = await bookingService.releaseSlot(userId, pitchId, slotId, date);
  res.status(200).json(result);
}

export async function myBookings(req: Request, res: Response) {
  const userId = requireUserId(req);
  const bookings = await bookingService.getMyBookings(userId);
  res.json(bookings);
}
