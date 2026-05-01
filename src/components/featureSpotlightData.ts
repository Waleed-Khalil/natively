export interface FeatureSlide {
    id: string;
    headline: string;
    subtitle: string;
    type?: 'feature' | 'support' | 'premium';
    actionLabel?: string;
    url?: string;
    eyebrow?: string;
    bullets?: string[];
    footer?: string;
}

export const FEATURES: FeatureSlide[] = [
    {
        id: 'tailored_answers',
        headline: 'Upcoming features',
        subtitle: 'Answers, tailored to you',
        bullets: ['Repo aware explanations', 'System design interview specialization'],
        footer: 'Designed to work silently during live interviews.',
        type: 'premium',
    },

    {
        id: 'support_natively',
        headline: 'Support development',
        subtitle: 'Built openly and sustained by users',
        bullets: [
            'Development driven by real users',
            'Faster iteration on features that matter',

        ],
        type: 'support',
        actionLabel: 'Contribute to development',
        url: 'https://buymeacoffee.com/evinjohnn'
    }
];
