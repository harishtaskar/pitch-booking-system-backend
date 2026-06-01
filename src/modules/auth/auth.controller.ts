import { Request, Response } from "express";
import { z } from "zod";
import * as authService from "./auth.service";

const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function register(req: Request, res: Response) {
  const data = registerSchema.parse(req.body);
  const result = await authService.register(data);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
  const data = loginSchema.parse(req.body);
  const result = await authService.login(data);
  res.status(200).json(result);
}

export async function logout(_req: Request, res: Response) {
  // JWTs are stateless: logout is handled client-side by discarding the token.
  // Endpoint exists for symmetry and future token-revocation support.
  res.status(200).json({ message: "Logged out" });
}
