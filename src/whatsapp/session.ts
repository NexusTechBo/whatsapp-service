import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, {
    Browsers,
    DisconnectReason,
    jidDecode,
    useMultiFileAuthState,
    type WASocket,
} from '@whiskeysockets/baileys';
import type { Logger } from 'pino';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { HttpError } from '../utils/httpError.ts';
import { normalizePhone } from '../utils/phone.ts';
import { createSendQueue } from './sendQueue.ts';

export type SessionStatus = 'IDLE' | 'INITIALIZING' | 'QR_PENDING' | 'PAIRING_PENDING' | 'READY' | 'DISCONNECTED';

export interface SendMessageInput {
    to: string;
    message: string;
}

const QR_WAIT_TIMEOUT_MS = 60_000;
const QR_TIMEOUT_MS = 20_000;
const RECONNECT_DELAY_MS = 3_000;

function phoneFromJid(jid: string | undefined): string | null {
    return (jid && jidDecode(jid)?.user) || null;
}

export class WhatsAppSession {
    readonly id: string;
    status: SessionStatus = 'IDLE';
    qr: string | null = null;
    pairingCode: string | null = null;
    phone: string | null = null;

    private readonly dir: string;
    private readonly log: Logger;
    private readonly baileysLog: Logger;
    private readonly enqueue = createSendQueue(config.sendDelayMs);
    private readonly onDiscard: (session: WhatsAppSession) => void;
    private sock: WASocket | null = null;
    private qrCount = 0;
    private pairingPhone: string | null = null;
    private pairingRequest: Promise<string> | null = null;
    private stopping = false;

    constructor(id: string, onDiscard: (session: WhatsAppSession) => void) {
        this.id = id;
        this.onDiscard = onDiscard;
        this.dir = path.join(config.sessionPath, id);
        this.log = logger.child({ session: id });
        this.baileysLog = this.log.child({ module: 'baileys' }, { level: 'warn' });
    }

    async hasLinkedCredentials(): Promise<boolean> {
        try {
            const creds = JSON.parse(await readFile(path.join(this.dir, 'creds.json'), 'utf8'));
            return Boolean(creds.account);
        } catch {
            return false;
        }
    }

    async connect(): Promise<void> {
        if (this.sock) return;

        this.status = 'INITIALIZING';
        this.qr = null;
        this.qrCount = 0;
        this.clearPairing();

        const { state: authState, saveCreds } = await useMultiFileAuthState(this.dir);
        if (authState.creds.account) this.phone = phoneFromJid(authState.creds.me?.id);
        const socket = makeWASocket({
            auth: authState,
            qrTimeout: QR_TIMEOUT_MS,
            logger: this.baileysLog,
            browser: Browsers.ubuntu('Chrome'),
            markOnlineOnConnect: false,
            syncFullHistory: false,
        });
        this.sock = socket;

        socket.ev.on('creds.update', () => {
            if (this.sock !== socket) return;
            saveCreds().catch((err) => this.log.error({ err }, 'Could not save credentials'));
        });

        socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            if (this.sock !== socket) return;

            if (qr) {
                this.qrCount++;
                if (!this.pairingCode && this.qrCount > config.qrMaxRetries) {
                    await socket.end(new Error('QR attempts exhausted'));
                    return;
                }
                if (!this.qr && !this.pairingCode) {
                    this.log.info(`QR code available at GET /api/sessions/${this.id}/qr`);
                }
                if (!this.pairingCode) this.status = 'QR_PENDING';
                this.qr = qr;
            }

            if (connection === 'open') {
                this.status = 'READY';
                this.qr = null;
                this.phone = phoneFromJid(socket.user?.id);
                this.clearPairing();
                this.log.info({ jid: socket.user?.id }, 'WhatsApp client ready');
            }

            if (connection === 'close') {
                this.sock = null;
                this.qr = null;
                this.clearPairing();
                const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
                    ?.statusCode;

                if (this.stopping) return;

                if (statusCode === DisconnectReason.restartRequired) {
                    this.log.info('Restart required by WhatsApp, reconnecting');
                    await this.connect();
                    return;
                }

                if (statusCode === DisconnectReason.loggedOut || !authState.creds.account) {
                    this.log.info({ statusCode }, 'No linked session; session discarded');
                    await this.discard();
                    return;
                }

                this.status = 'DISCONNECTED';
                this.log.warn({ statusCode }, 'Client disconnected, retrying...');
                setTimeout(() => void this.connect(), RECONNECT_DELAY_MS);
            }
        });
    }

    async requestQr(): Promise<string | null> {
        if (this.status === 'IDLE' || (this.status === 'DISCONNECTED' && !this.sock)) {
            await this.connect();
        }
        return this.waitForQr();
    }

    async requestPairingCode(rawPhone: string): Promise<string> {
        const phone = normalizePhone(rawPhone);
        if (!phone) {
            throw new HttpError(400, 'Invalid phone number: it must include the country code', { phone: rawPhone });
        }
        if (this.status === 'READY' || this.status === 'DISCONNECTED') {
            throw new HttpError(409, 'Session is already linked', { session: this.id, status: this.status });
        }
        if (this.pairingPhone === phone) {
            if (this.pairingRequest) return this.pairingRequest;
            if (this.pairingCode && this.sock) return this.pairingCode;
        }

        const request = this.startPairing(phone);
        this.pairingPhone = phone;
        this.pairingRequest = request;
        try {
            return await request;
        } finally {
            if (this.pairingRequest === request) this.pairingRequest = null;
        }
    }

    private async startPairing(phone: string): Promise<string> {
        if (this.status === 'IDLE') await this.connect();

        if ((await this.waitForQr()) === null || !this.sock) {
            throw new HttpError(409, 'Session is already linked', { session: this.id, status: this.status });
        }

        const code = await this.sock.requestPairingCode(phone);
        const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
        this.pairingCode = formatted;
        this.status = 'PAIRING_PENDING';
        this.log.info({ phone }, 'Pairing code generated');
        return formatted;
    }

    private clearPairing(): void {
        this.pairingCode = null;
        this.pairingPhone = null;
    }

    private async waitForQr(): Promise<string | null> {
        const deadline = Date.now() + QR_WAIT_TIMEOUT_MS;
        while (!this.qr) {
            if (this.status === 'READY') return null;
            if (this.status === 'IDLE') {
                throw new HttpError(410, 'Session was discarded before a QR code was generated', { session: this.id });
            }
            if (Date.now() > deadline) {
                throw new HttpError(504, 'Timed out waiting for the QR code', { status: this.status });
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        return this.qr;
    }

    async logout(): Promise<void> {
        const socket = this.sock;
        if (this.status !== 'READY' || !socket) {
            throw new HttpError(409, 'No active session', { session: this.id, status: this.status });
        }
        this.sock = null;
        try {
            await socket.logout();
        } catch (err) {
            this.log.warn({ err }, 'Logout request failed; closing socket anyway');
            await socket.end(undefined);
        }
        await this.discard();
    }

    async stop(): Promise<void> {
        this.stopping = true;
        await this.sock?.end(undefined);
        this.sock = null;
    }

    async sendMessage({ to, message }: SendMessageInput) {
        const socket = this.sock;
        if (this.status !== 'READY' || !socket) {
            throw new HttpError(503, 'WhatsApp client is not ready', { session: this.id, status: this.status });
        }

        const phone = normalizePhone(to);
        if (!phone) {
            throw new HttpError(400, 'Invalid phone number: it must include the country code', { to });
        }

        const [result] = (await socket.onWhatsApp(phone)) ?? [];
        if (!result?.exists) {
            throw new HttpError(422, 'Phone number is not registered on WhatsApp', { to: phone });
        }
        const jid = result.jid;

        return this.enqueue(async () => {
            const sent = await socket.sendMessage(jid, { text: message });

            if (!sent?.key.id) {
                this.log.error({ to: phone, jid }, 'WhatsApp did not confirm the message was sent');
                throw new HttpError(502, 'WhatsApp did not confirm the message was sent', { to: phone });
            }

            this.log.info({ to: phone, messageId: sent.key.id }, 'Message sent');
            return {
                session: this.id,
                messageId: sent.key.id,
                to: phone,
                timestamp: Number(sent.messageTimestamp ?? Math.floor(Date.now() / 1000)),
            };
        });
    }

    private async discard(): Promise<void> {
        await rm(this.dir, { recursive: true, force: true }).catch((err) =>
            this.log.warn({ err }, 'Could not delete session folder'),
        );
        this.status = 'IDLE';
        this.qr = null;
        this.phone = null;
        this.clearPairing();
        this.onDiscard(this);
    }
}
