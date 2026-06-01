import { Request, Response, Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { getAvailability } from "./slot.service";

const router = Router();

const querySchema = z.object({
  pitchId: z.string().min(1, "pitchId is required"),
  date: z.string().min(1, "date is required"),
});

router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { pitchId, date } = querySchema.parse(req.query);
    const result = await getAvailability(pitchId, date);
    res.json(result);
  })
);

export default router;
