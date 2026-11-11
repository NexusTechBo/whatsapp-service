import express, { type Express } from 'express';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { apiKey } from './middlewares/apiKey.ts';
import { errorHandler } from './middlewares/errorHandler.ts';
import { messagesRouter } from './routes/messages.routes.ts';
import { sessionsRouter } from './routes/sessions.routes.ts';
import { listSessions, restoreSessions, stopAllSessions } from './whatsapp/sessionManager.ts';

const app: Express = express();

app.use(express.json());

app.get('/health', (req, res) => {
    const sessions = listSessions();
    res.json({ ok: true, sessions: sessions.length, ready: sessions.filter((s) => s.status === 'READY').length });
});

app.use('/api/messages', apiKey, messagesRouter);
app.use('/api/sessions', apiKey, sessionsRouter);

app.use(errorHandler);

const server = app.listen(config.port, () => {
    logger.info(`Server listening on http://localhost:${config.port}`);
});

void restoreSessions();

async function shutdown(signal: string) {
    logger.info({ signal }, 'Shutting down...');
    server.close();
    await stopAllSessions();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
