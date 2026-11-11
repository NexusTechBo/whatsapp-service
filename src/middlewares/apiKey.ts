import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.ts';

const expected = Buffer.from(config.apiKey);

export function apiKey(req: Request, res: Response, next: NextFunction) {
    const provided = Buffer.from(req.header('x-api-key') ?? '');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        res.status(401).json({ success: false, error: 'Invalid or missing API key' });
        return;
    }
    next();
}
