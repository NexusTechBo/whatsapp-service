function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

export const config = {
    port: Number(process.env.PORT ?? 3000),
    apiKey: required('API_KEY'),
    sessionPath: process.env.WA_SESSION_PATH ?? '.baileys_auth',
    maxSessions: Number(process.env.WA_MAX_SESSIONS ?? 5),
    qrMaxRetries: Number(process.env.WA_QR_MAX_RETRIES ?? 5),
    sendDelayMs: Number(process.env.SEND_DELAY_MS ?? 1500),
    logLevel: process.env.LOG_LEVEL ?? 'info',
};
