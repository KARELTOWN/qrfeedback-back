import type { Request, Response } from "express";
import * as telegramAdService from "../services/telegramAd.service.js";

export async function listTelegramAds(req: Request, res: Response) {
  const status = ["all", "draft", "published", "sent", "active"].includes(String(req.query.status))
    ? (String(req.query.status) as "all" | "draft" | "published" | "sent" | "active")
    : undefined;

  res.json(await telegramAdService.listTelegramAds({
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    status,
  }));
}

export async function getTelegramAd(req: Request, res: Response) {
  res.json(await telegramAdService.getTelegramAd(String(req.params.adId)));
}

export async function createTelegramAd(req: Request, res: Response) {
  const ad = await telegramAdService.createTelegramAd({
    ...req.body,
    userId: req.user?._id,
  });
  res.status(201).json(ad);
}

export async function updateTelegramAd(req: Request, res: Response) {
  res.json(await telegramAdService.updateTelegramAd(String(req.params.adId), {
    ...req.body,
    userId: req.user?._id,
  }));
}

export async function setTelegramAdActive(req: Request, res: Response) {
  res.json(await telegramAdService.setTelegramAdActive(
    String(req.params.adId),
    Boolean(req.body.isActive),
    req.user?._id,
  ));
}

export async function publishTelegramAd(req: Request, res: Response) {
  res.json(await telegramAdService.publishTelegramAd(String(req.params.adId), req.user?._id));
}
