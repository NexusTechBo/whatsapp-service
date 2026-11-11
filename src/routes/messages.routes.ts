import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_SESSION_ID, getSession } from '../whatsapp/sessionManager.ts';

const sendSchema = z.object({
    session: z.string().min(1).default(DEFAULT_SESSION_ID),
    to: z.string().min(1),
    message: z.string().min(1).max(4096),
});

export const messagesRouter = Router();

messagesRouter.post('/send', async (req, res) => {
    const { session, ...body } = sendSchema.parse(req.body);
    const result = await getSession(session).sendMessage(body);
    res.status(200).json({ success: true, ...result });
});
