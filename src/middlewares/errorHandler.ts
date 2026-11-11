import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger.ts';
import { HttpError } from '../utils/httpError.ts';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
    if (err instanceof ZodError) {
        res.status(400).json({ success: false, error: 'Invalid request body', details: err.issues });
        return;
    }
    if (err instanceof HttpError) {
        res.status(err.status).json({ success: false, error: err.message, details: err.details });
        return;
    }

    if (err instanceof Error && 'status' in err && typeof err.status === 'number' && err.status < 500) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
    }

    logger.error({ err, path: req.path }, 'Unhandled error');
    res.status(500).json({ success: false, error: 'Internal server error' });
}
