import React, { useState, useEffect } from 'react';
import { CheckCircle, Save, AlertCircle } from 'lucide-react';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

/**
 * AI provider settings — Claude-only.
 *
 * The app supports a single chat LLM provider: Anthropic Claude. This panel
 * stores the user's Claude API key, exposes a connection test, and reports
 * whether a key is currently saved.
 */
export const AIProvidersSettings: React.FC = () => {
    const [claudeApiKey, setClaudeApiKey] = useState('');
    const [hasStoredKey, setHasStoredKey] = useState<boolean>(false);
    const [savingStatus, setSavingStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [testError, setTestError] = useState<string | null>(null);
    const [defaultModel, setDefaultModel] = useState<string>(CLAUDE_MODEL);

    useEffect(() => {
        const load = async () => {
            try {
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (creds) {
                    setHasStoredKey(!!creds.hasClaudeKey);
                }
                // @ts-ignore
                const result = await window.electronAPI?.getDefaultModel();
                if (result && result.model) setDefaultModel(result.model);
            } catch (e) {
                console.error('[AIProvidersSettings] Failed to load credentials:', e);
            }
        };
        load();
    }, []);

    const saveKey = async () => {
        const key = claudeApiKey.trim();
        if (!key) return;
        setSavingStatus('saving');
        try {
            // @ts-ignore
            const res = await window.electronAPI?.setClaudeApiKey?.(key);
            if (res?.success) {
                setSavingStatus('saved');
                setHasStoredKey(true);
                setClaudeApiKey('');
                setTimeout(() => setSavingStatus('idle'), 1500);
            } else {
                setSavingStatus('error');
            }
        } catch {
            setSavingStatus('error');
        }
    };

    const testConnection = async () => {
        setTestStatus('testing');
        setTestError(null);
        try {
            // @ts-ignore
            const res = await window.electronAPI?.testLlmConnection?.('claude', claudeApiKey.trim() || undefined);
            if (res?.success) {
                setTestStatus('success');
                setTimeout(() => setTestStatus('idle'), 2500);
            } else {
                setTestStatus('error');
                setTestError(res?.error || 'Connection failed');
            }
        } catch (e: any) {
            setTestStatus('error');
            setTestError(e?.message || 'Connection failed');
        }
    };

    return (
        <div className="flex flex-col gap-6 p-6 max-w-2xl">
            <div>
                <h2 className="text-lg font-semibold text-text-primary mb-1">AI Provider</h2>
                <p className="text-sm text-text-secondary">
                    Natively uses <strong>Anthropic Claude</strong> for all chat completions. Bring your own API key to enable assistance, suggestions, recaps, and follow-ups.
                </p>
            </div>

            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-primary">Anthropic API key</label>
                <div className="flex items-center gap-2">
                    <input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={claudeApiKey}
                        onChange={(e) => setClaudeApiKey(e.target.value)}
                        placeholder={hasStoredKey ? 'Key saved · paste a new key to replace' : 'sk-ant-...'}
                        className="flex-1 px-3 py-2 rounded-lg bg-bg-elevated border border-border-muted text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-blue-500 transition-colors"
                    />
                    <button
                        onClick={saveKey}
                        disabled={!claudeApiKey.trim() || savingStatus === 'saving'}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 text-blue-500 text-sm font-medium hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {savingStatus === 'saving' ? (
                            <>Saving...</>
                        ) : savingStatus === 'saved' ? (
                            <><CheckCircle size={14} /> Saved</>
                        ) : (
                            <><Save size={14} /> Save key</>
                        )}
                    </button>
                </div>
                {savingStatus === 'error' && (
                    <p className="flex items-center gap-1 text-xs text-red-500">
                        <AlertCircle size={12} /> Could not save the key. Try again.
                    </p>
                )}
                {hasStoredKey && (
                    <p className="text-xs text-text-tertiary">
                        A Claude key is currently saved. Default model: <code className="px-1 py-0.5 rounded bg-bg-elevated">{defaultModel}</code>
                    </p>
                )}
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={testConnection}
                    disabled={testStatus === 'testing' || (!claudeApiKey.trim() && !hasStoredKey)}
                    className="px-3 py-2 rounded-lg bg-bg-elevated text-text-primary text-sm font-medium border border-border-muted hover:bg-bg-elevated/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {testStatus === 'testing' ? 'Testing connection...' : 'Test connection'}
                </button>
                {testStatus === 'success' && (
                    <span className="flex items-center gap-1 text-xs text-emerald-500">
                        <CheckCircle size={12} /> Connection OK
                    </span>
                )}
                {testStatus === 'error' && testError && (
                    <span className="flex items-center gap-1 text-xs text-red-500">
                        <AlertCircle size={12} /> {testError}
                    </span>
                )}
            </div>

            <p className="text-xs text-text-tertiary">
                Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">console.anthropic.com</a>. Keys are stored encrypted on this device only.
            </p>
        </div>
    );
};
