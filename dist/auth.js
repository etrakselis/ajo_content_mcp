export class AdobeTokenManager {
    config;
    cached = null;
    inflight = null;
    constructor(config) {
        this.config = config;
    }
    async getAccessToken(forceRefresh = false) {
        if (!forceRefresh && this.cached && !this.isExpired(this.cached)) {
            return this.cached.accessToken;
        }
        if (this.inflight) {
            return (await this.inflight).accessToken;
        }
        this.inflight = this.fetchToken();
        try {
            this.cached = await this.inflight;
            return this.cached.accessToken;
        }
        finally {
            this.inflight = null;
        }
    }
    isExpired(record) {
        return Date.now() >= record.expiresAtMs - this.config.tokenSkewSeconds * 1000;
    }
    async fetchToken() {
        const body = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.config.apiKey,
            client_secret: this.config.clientSecret,
            scope: this.config.scopes.join(',')
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const response = await fetch(this.config.tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: 'application/json'
                },
                body,
                signal: controller.signal
            });
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : {};
            if (!response.ok) {
                const details = parsed.error_description ?? parsed.error ?? text;
                throw new Error(`Token request failed: HTTP ${response.status} ${response.statusText}${details ? ` - ${details}` : ''}`);
            }
            if (!parsed.access_token) {
                throw new Error('Token response did not contain access_token');
            }
            const expiresInSeconds = Number(parsed.expires_in ?? 3600);
            const safeExpires = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600;
            return {
                accessToken: parsed.access_token,
                expiresAtMs: Date.now() + safeExpires * 1000
            };
        }
        finally {
            clearTimeout(timer);
        }
    }
}
//# sourceMappingURL=auth.js.map