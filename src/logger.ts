import { pino } from 'pino';
import { config } from './config.ts';

export const logger = pino({
    level: config.logLevel,
    transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});
