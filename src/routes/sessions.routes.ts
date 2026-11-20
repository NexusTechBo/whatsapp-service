import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { getOrCreateSession, getSession, listSessions } from '../whatsapp/sessionManager.ts';

export const sessionsRouter = Router();

sessionsRouter.get('/', (req, res) => {
    res.json({ sessions: listSessions() });
});

sessionsRouter.get('/:id/status', (req, res) => {
    const { id, status, phone } = getSession(req.params.id);
    res.json({ id, status, phone });
});

sessionsRouter.get('/:id/qr', async (req, res) => {
    const session = getOrCreateSession(req.params.id);
    const qr = await session.requestQr();
    if (!qr) {
        res.status(204).end();
        return;
    }

    if (req.query.format === 'base64') {
        res.json({ id: session.id, status: session.status, qr: await QRCode.toDataURL(qr) });
        return;
    }
    res.type('png').send(await QRCode.toBuffer(qr, { width: 300 }));
});

const pairingSchema = z.object({
    phone: z.string().min(1),
});

sessionsRouter.post('/:id/pairing-code', async (req, res) => {
    const { phone } = pairingSchema.parse(req.body);
    const session = getOrCreateSession(req.params.id);
    const code = await session.requestPairingCode(phone);
    res.json({ id: session.id, status: session.status, code });
});

sessionsRouter.post('/:id/logout', async (req, res) => {
    await getSession(req.params.id).logout();
    res.json({ success: true });
});
