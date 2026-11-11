import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { HttpError } from '../utils/httpError.ts';
import { WhatsAppSession } from './session.ts';

export const DEFAULT_SESSION_ID = 'default';

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;

const sessions = new Map<string, WhatsAppSession>();

function assertValidId(id: string): void {
    if (!SESSION_ID_PATTERN.test(id)) {
        throw new HttpError(400, 'Invalid session id: use 1-32 letters, numbers, "-" or "_"', { session: id });
    }
}

function removeSession(session: WhatsAppSession): void {
    if (sessions.get(session.id) === session) {
        sessions.delete(session.id);
    }
}

export function getSession(id: string): WhatsAppSession {
    assertValidId(id);
    const session = sessions.get(id);
    if (!session) {
        throw new HttpError(404, 'Session not found', { session: id });
    }
    return session;
}

export function getOrCreateSession(id: string): WhatsAppSession {
    assertValidId(id);
    const existing = sessions.get(id);
    if (existing) return existing;

    if (sessions.size >= config.maxSessions) {
        throw new HttpError(429, 'Maximum number of sessions reached', { max: config.maxSessions });
    }
    const session = new WhatsAppSession(id, removeSession);
    sessions.set(id, session);
    return session;
}

export function listSessions() {
    return [...sessions.values()].map(({ id, status }) => ({ id, status }));
}

export async function restoreSessions(): Promise<void> {
    const entries = await readdir(config.sessionPath, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
        if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue;

        const session = new WhatsAppSession(entry.name, removeSession);
        if (!(await session.hasLinkedCredentials())) {
            await rm(path.join(config.sessionPath, entry.name), { recursive: true, force: true });
            continue;
        }
        if (sessions.size >= config.maxSessions) {
            logger.warn({ session: entry.name, max: config.maxSessions }, 'Session not restored: limit reached');
            continue;
        }
        sessions.set(entry.name, session);
        await session.connect();
    }

    logger.info({ restored: sessions.size }, 'Sessions restored; request new ones with GET /api/sessions/:id/qr');
}

export async function stopAllSessions(): Promise<void> {
    await Promise.all([...sessions.values()].map((session) => session.stop().catch(() => {})));
}
