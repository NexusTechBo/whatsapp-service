export function normalizePhone(raw: string): string | null {
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
