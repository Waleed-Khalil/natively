/**
 * modelFetcher.ts - Dynamic Model Discovery
 * Fetches available Claude models from Anthropic.
 */

import axios from 'axios';

export interface ProviderModel {
    id: string;
    label: string;
}

type Provider = 'claude';

/**
 * Fetch available models from Anthropic.
 */
export async function fetchProviderModels(
    _provider: Provider,
    apiKey: string
): Promise<ProviderModel[]> {
    return fetchAnthropicModels(apiKey);
}

async function fetchAnthropicModels(apiKey: string): Promise<ProviderModel[]> {
    const response = await axios.get('https://api.anthropic.com/v1/models', {
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        timeout: 15000,
    });

    const models: any[] = response.data?.data || [];

    // Only include Claude 3.5+ models (haiku, sonnet, opus)
    const filtered = models.filter((m: any) => {
        const id = (m.id || '').toLowerCase();
        if (!id.includes('claude')) return false;

        const versionMatch = id.match(/claude-(\d+)-(\d+)?/);
        if (versionMatch) {
            const major = parseInt(versionMatch[1], 10);
            const minor = versionMatch[2] ? parseInt(versionMatch[2], 10) : 0;
            if (major > 3 || (major === 3 && minor >= 5)) {
                return true;
            }
        }
        return false;
    });

    return filtered
        .map((m: any) => ({ id: m.id, label: m.display_name || m.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
}
