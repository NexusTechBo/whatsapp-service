import { Router } from 'express';
import QRCode from 'qrcode';
import { getOrCreateSession, getSession, listSessions } from '../whatsapp/sessionManager.ts';

export const sessionsRouter = Router();

sessionsRouter.get('/', (req, res) => {
    res.json({ sessions: listSessions() });
});

sessionsRouter.get('/:id/status', (req, res) => {
    const { id, status } = getSession(req.params.id);
    res.json({ id, status });
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

sessionsRouter.post('/:id/logout', async (req, res) => {
    await getSession(req.params.id).logout();
    res.json({ success: true });
});
