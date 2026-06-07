export type AdobeAuthConfig = {
    apiKey: string;
    clientSecret: string;
    scopes: string[];
    tokenUrl: string;
    tokenSkewSeconds: number;
    timeoutMs: number;
};
export declare class AdobeTokenManager {
    private readonly config;
    private cached;
    private inflight;
    constructor(config: AdobeAuthConfig);
    getAccessToken(forceRefresh?: boolean): Promise<string>;
    private isExpired;
    private fetchToken;
}
