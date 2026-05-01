/**
 * Provider format adaptation — the only thing that should differ across
 * providers is how content is delimited / labeled. Behavior lives in the
 * action body; framing lives in the framing layer; this file is purely
 * cosmetic.
 *
 * Empirically (from the legacy CLAUDE_*, GROQ_*, OPENAI_* prompt variants):
 *   - Claude: structured XML tags (<task>, <rules>, <output>, <security>)
 *   - Groq: terse plain text, sectioned by ALL-CAPS headers
 *   - OpenAI: plain text with simple headers
 *   - Gemini: plain text with simple headers
 *   - Custom (cURL templates / unknown providers): plain text, conservative
 */

import type { Provider } from './types';

interface FormatStyle {
    /** Wraps a section with a label, e.g. ("task", "do X") → "<task>\ndo X\n</task>". */
    section: (label: string, body: string) => string;
    /** Wraps the whole prompt — most providers don't need this. */
    envelope?: (body: string) => string;
}

const XML_STYLE: FormatStyle = {
    section: (label, body) => `<${label}>\n${body}\n</${label}>`,
};

const HEADER_STYLE: FormatStyle = {
    section: (label, body) => {
        const heading = label.toUpperCase().replace(/_/g, ' ');
        return `${heading}:\n${body}`;
    },
};

const STYLES: Record<Provider, FormatStyle> = {
    claude:  XML_STYLE,
    gemini:  HEADER_STYLE,
    openai:  HEADER_STYLE,
    groq:    HEADER_STYLE,
    custom:  HEADER_STYLE,
};

export function getFormat(provider: Provider): FormatStyle {
    return STYLES[provider] ?? HEADER_STYLE;
}

/**
 * Convenience: render a labeled section in the provider's preferred style.
 */
export function section(provider: Provider, label: string, body: string): string {
    return getFormat(provider).section(label, body);
}
