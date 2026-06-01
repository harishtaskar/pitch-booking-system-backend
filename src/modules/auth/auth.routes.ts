import { Router } from "express";
import { authMiddleware } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import * as authController from "./auth.controller";

const router = Router();

router.post("/register", asyncHandler(authController.register));
router.post("/login", asyncHandler(authController.login));
router.post("/logout", authMiddleware, asyncHandler(authController.logout));

export default router;
