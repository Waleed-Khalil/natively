/**
 * CredentialsManager - Secure storage for API keys and service account paths
 * Uses Electron's safeStorage API for encryption at rest
 *
 * Note: this app uses Claude as the only chat LLM. Non-Claude API keys
 * (`openaiApiKey`, `geminiApiKey`) are still stored here because OpenAI and
 * Google APIs are used by STT and embedding providers (Anthropic does not
 * offer those services). Their chat-LLM setters and IPC handlers have been
 * removed; only embedding/STT paths read them.
 */

import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'credentials.enc');

export interface StoredCredentials {
    // Chat LLM key (Claude is the only supported chat provider)
    claudeApiKey?: string;
    // Embedding-only keys (Anthropic has no embeddings API)
    openaiApiKey?: string;
    geminiApiKey?: string;
    googleServiceAccountPath?: string;
    defaultModel?: string;
    // STT Provider settings
    sttProvider?: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox';
    groqSttApiKey?: string;
    groqSttModel?: string;
    openAiSttApiKey?: string;
    deepgramApiKey?: string;
    elevenLabsApiKey?: string;
    azureApiKey?: string;
    azureRegion?: string;
    ibmWatsonApiKey?: string;
    ibmWatsonRegion?: string;
    sonioxApiKey?: string;
    sttLanguage?: string;
    aiResponseLanguage?: string;
    // Tavily Search
    tavilyApiKey?: string;
    // Dynamic Model Discovery – preferred Claude model
    claudePreferredModel?: string;
}

export class CredentialsManager {
    private static instance: CredentialsManager;
    private credentials: StoredCredentials = {};

    private constructor() {
        // Load on construction after app ready
    }

    public static getInstance(): CredentialsManager {
        if (!CredentialsManager.instance) {
            CredentialsManager.instance = new CredentialsManager();
        }
        return CredentialsManager.instance;
    }

    /**
     * Initialize - load credentials from disk
     * Must be called after app.whenReady()
     */
    public init(): void {
        this.loadCredentials();
        console.log('[CredentialsManager] Initialized');
    }

    // =========================================================================
    // Getters
    // =========================================================================

    public getClaudeApiKey(): string | undefined {
        return this.credentials.claudeApiKey;
    }

    /**
     * OpenAI API key — used by OpenAI Whisper STT and OpenAI embedding
     * provider only. Not used as a chat LLM.
     */
    public getOpenaiApiKey(): string | undefined {
        return this.credentials.openaiApiKey;
    }

    /**
     * Gemini API key — used by Gemini embedding provider only. Not used as
     * a chat LLM.
     */
    public getGeminiApiKey(): string | undefined {
        return this.credentials.geminiApiKey;
    }

    public getGoogleServiceAccountPath(): string | undefined {
        return this.credentials.googleServiceAccountPath;
    }

    public getSttProvider(): 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' {
        return this.credentials.sttProvider || 'none';
    }

    public getDeepgramApiKey(): string | undefined {
        return this.credentials.deepgramApiKey;
    }

    public getGroqSttApiKey(): string | undefined {
        return this.credentials.groqSttApiKey;
    }

    public getGroqSttModel(): string {
        return this.credentials.groqSttModel || 'whisper-large-v3-turbo';
    }

    public getOpenAiSttApiKey(): string | undefined {
        return this.credentials.openAiSttApiKey;
    }

    public getElevenLabsApiKey(): string | undefined {
        return this.credentials.elevenLabsApiKey;
    }

    public getAzureApiKey(): string | undefined {
        return this.credentials.azureApiKey;
    }

    public getAzureRegion(): string {
        return this.credentials.azureRegion || 'eastus';
    }

    public getIbmWatsonApiKey(): string | undefined {
        return this.credentials.ibmWatsonApiKey;
    }

    public getIbmWatsonRegion(): string {
        return this.credentials.ibmWatsonRegion || 'us-south';
    }

    public getSonioxApiKey(): string | undefined {
        return this.credentials.sonioxApiKey;
    }

    public getTavilyApiKey(): string | undefined {
        return this.credentials.tavilyApiKey;
    }

    public getSttLanguage(): string {
        return this.credentials.sttLanguage || 'english-us';
    }

    public getAiResponseLanguage(): string {
        return this.credentials.aiResponseLanguage || 'auto';
    }

    public getDefaultModel(): string {
        return this.credentials.defaultModel || 'claude-sonnet-4-6';
    }

    public getAllCredentials(): StoredCredentials {
        return { ...this.credentials };
    }

    // =========================================================================
    // Setters (auto-save)
    // =========================================================================

    public setClaudeApiKey(key: string): void {
        this.credentials.claudeApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Claude API Key updated');
    }

    /**
     * OpenAI key setter — STT/embeddings only.
     */
    public setOpenaiApiKey(key: string): void {
        this.credentials.openaiApiKey = key.trim() || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI API Key (STT/embedding) updated');
    }

    /**
     * Gemini key setter — embeddings only.
     */
    public setGeminiApiKey(key: string): void {
        this.credentials.geminiApiKey = key.trim() || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Gemini API Key (embedding) updated');
    }

    public setGoogleServiceAccountPath(filePath: string): void {
        this.credentials.googleServiceAccountPath = filePath;
        this.saveCredentials();
        console.log('[CredentialsManager] Google Service Account path updated');
    }

    public setSttProvider(provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox'): void {
        this.credentials.sttProvider = provider;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Provider set to: ${provider}`);
    }

    public setDeepgramApiKey(key: string): void {
        this.credentials.deepgramApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Deepgram API Key updated');
    }

    public setGroqSttApiKey(key: string): void {
        this.credentials.groqSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq STT API Key updated');
    }

    public setOpenAiSttApiKey(key: string): void {
        this.credentials.openAiSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI STT API Key updated');
    }

    public setGroqSttModel(model: string): void {
        this.credentials.groqSttModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Groq STT Model set to: ${model}`);
    }

    public setElevenLabsApiKey(key: string): void {
        this.credentials.elevenLabsApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] ElevenLabs API Key updated');
    }

    public setAzureApiKey(key: string): void {
        this.credentials.azureApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Azure API Key updated');
    }

    public setAzureRegion(region: string): void {
        this.credentials.azureRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] Azure Region set to: ${region}`);
    }

    public setIbmWatsonApiKey(key: string): void {
        this.credentials.ibmWatsonApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] IBM Watson API Key updated');
    }

    public setIbmWatsonRegion(region: string): void {
        this.credentials.ibmWatsonRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] IBM Watson Region set to: ${region}`);
    }

    public setSonioxApiKey(key: string): void {
        this.credentials.sonioxApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Soniox API Key updated');
    }

    public setTavilyApiKey(key: string): void {
        this.credentials.tavilyApiKey = key.trim() || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Tavily API Key updated');
    }

    public setSttLanguage(language: string): void {
        this.credentials.sttLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Language set to: ${language}`);
    }

    public setAiResponseLanguage(language: string): void {
        this.credentials.aiResponseLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] AI Response Language set to: ${language}`);
    }

    public setDefaultModel(model: string): void {
        this.credentials.defaultModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Default Model set to: ${model}`);
    }

    public getPreferredModel(): string | undefined {
        return this.credentials.claudePreferredModel;
    }

    public setPreferredModel(modelId: string): void {
        this.credentials.claudePreferredModel = modelId;
        this.saveCredentials();
        console.log(`[CredentialsManager] Claude preferred model set to: ${modelId}`);
    }

    public clearAll(): void {
        this.scrubMemory();
        if (fs.existsSync(CREDENTIALS_PATH)) {
            fs.unlinkSync(CREDENTIALS_PATH);
        }
        const plaintextPath = CREDENTIALS_PATH + '.json';
        if (fs.existsSync(plaintextPath)) {
            fs.unlinkSync(plaintextPath);
        }
        console.log('[CredentialsManager] All credentials cleared');
    }

    /**
     * Scrub all API keys from memory to minimize exposure window.
     * Called on app quit and credential clear.
     */
    public scrubMemory(): void {
        for (const key of Object.keys(this.credentials) as (keyof StoredCredentials)[]) {
            const val = this.credentials[key];
            if (typeof val === 'string') {
                (this.credentials as any)[key] = '';
            }
        }
        this.credentials = {};
        console.log('[CredentialsManager] Memory scrubbed');
    }

    // =========================================================================
    // Storage (Encrypted)
    // =========================================================================

    private saveCredentials(): void {
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                console.warn('[CredentialsManager] Encryption not available, falling back to plaintext');
                const plainPath = CREDENTIALS_PATH + '.json';
                const tmpPlain = plainPath + '.tmp';
                fs.writeFileSync(tmpPlain, JSON.stringify(this.credentials));
                fs.renameSync(tmpPlain, plainPath);
                return;
            }

            const data = JSON.stringify(this.credentials);
            const encrypted = safeStorage.encryptString(data);
            const tmpEnc = CREDENTIALS_PATH + '.tmp';
            fs.writeFileSync(tmpEnc, encrypted);
            fs.renameSync(tmpEnc, CREDENTIALS_PATH);
        } catch (error) {
            console.error('[CredentialsManager] Failed to save credentials:', error);
        }
    }

    private loadCredentials(): void {
        try {
            if (fs.existsSync(CREDENTIALS_PATH)) {
                if (!safeStorage.isEncryptionAvailable()) {
                    console.warn('[CredentialsManager] Encryption not available for load');
                    return;
                }

                const encrypted = fs.readFileSync(CREDENTIALS_PATH);
                const decrypted = safeStorage.decryptString(encrypted);
                try {
                    const parsed = JSON.parse(decrypted);
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.credentials = parsed;
                        console.log('[CredentialsManager] Loaded encrypted credentials');
                    } else {
                        throw new Error('Decrypted credentials is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[CredentialsManager] Failed to parse decrypted credentials — file may be corrupted. Starting fresh:', parseError);
                    this.credentials = {};
                }

                const plaintextPath = CREDENTIALS_PATH + '.json';
                if (fs.existsSync(plaintextPath)) {
                    try {
                        fs.unlinkSync(plaintextPath);
                        console.log('[CredentialsManager] Removed stale plaintext credential file');
                    } catch (cleanupErr) {
                        console.warn('[CredentialsManager] Could not remove stale plaintext file:', cleanupErr);
                    }
                }
                return;
            }

            const plaintextPath = CREDENTIALS_PATH + '.json';
            if (fs.existsSync(plaintextPath)) {
                const data = fs.readFileSync(plaintextPath, 'utf-8');
                try {
                    const parsed = JSON.parse(data);
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.credentials = parsed;
                        console.log('[CredentialsManager] Loaded plaintext credentials');
                    } else {
                        throw new Error('Plaintext credentials is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[CredentialsManager] Failed to parse plaintext credentials — file may be corrupted. Starting fresh:', parseError);
                    this.credentials = {};
                }
                return;
            }

            console.log('[CredentialsManager] No stored credentials found');
        } catch (error) {
            console.error('[CredentialsManager] Failed to load credentials:', error);
            this.credentials = {};
        }
    }
}
