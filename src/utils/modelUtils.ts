export const STANDARD_CLOUD_MODELS: Record<string, {
    hasKeyCheck: (creds: any) => boolean;
    ids: string[];
    names: string[];
    descs: string[];
    pmKey: 'claudePreferredModel';
}> = {
    claude: {
        hasKeyCheck: (creds) => !!creds?.hasClaudeKey,
        ids: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
        names: ['Sonnet 4.6', 'Haiku 4.5'],
        descs: ['Anthropic • High Quality', 'Anthropic • Fast'],
        pmKey: 'claudePreferredModel'
    },
};

export const prettifyModelId = (id: string): string => {
    if (!id) return '';
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};
