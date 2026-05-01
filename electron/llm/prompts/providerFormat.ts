/**
 * Provider format adaptation. The codebase only targets Claude; we keep this
 * indirection (rather than inlining XML tags everywhere) so action prompt
 * builders that already call `section(provider, label, body)` continue to
 * work without churn.
 */

import type { Provider } from './types';

interface FormatStyle {
    /** Wraps a section with a label, e.g. ("task", "do X") → "<task>\ndo X\n</task>". */
    section: (label: string, body: string) => string;
    /** Wraps the whole prompt — Claude doesn't need this. */
    envelope?: (body: string) => string;
}

const XML_STYLE: FormatStyle = {
    section: (label, body) => `<${label}>\n${body}\n</${label}>`,
};

const STYLES: Record<Provider, FormatStyle> = {
    claude: XML_STYLE,
};

export function getFormat(provider: Provider): FormatStyle {
    return STYLES[provider] ?? XML_STYLE;
}

/**
 * Convenience: render a labeled section in the provider's preferred style.
 */
export function section(provider: Provider, label: string, body: string): string {
    return getFormat(provider).section(label, body);
}
