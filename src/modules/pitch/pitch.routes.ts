import { Request, Response, Router } from "express";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();

router.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const pitches = await prisma.pitch.findMany({ orderBy: { name: "asc" } });
    res.json(pitches);
  })
);

export default router;
