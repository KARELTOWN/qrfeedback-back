import type { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';

export async function signup(req: Request, res: Response) {
  const result = await authService.signup(req.body);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
  const result = await authService.login(req.body);
  res.json(result);
}


export async function verifyOtp(req: Request, res: Response) {
  const result = await authService.verifyOtp(req.body);
  res.json(result);
}

export async function changePassword(req: Request, res: Response) {
  await authService.changePassword({
    user: req.user,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword
  });
  res.json({ ok: true });
}

export async function forgotPassword(req: Request, res: Response) {
  await authService.forgotPassword(req.body.email);
  res.json({ ok: true });
}

export async function resendOtp(req: Request, res: Response) {
  const result = await authService.resendOtp(req.body);
  res.json(result);
}

export async function resetPassword(req: Request, res: Response) {
  await authService.resetPassword(req.body);
  res.json({ ok: true });
}
