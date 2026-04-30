import React from 'react';
import { Star } from 'lucide-react';

// StarRating — renders filled/empty stars for culture ratings
export const StarRating: React.FC<{ value: number; size?: number }> = ({ value, size = 11 }) => {
    const clamped = Math.min(5, Math.max(0, value ?? 0));
    // Round to nearest 0.5 so 3.7→3.5 stars, 3.8→4 stars, 4.75→5 stars
    const rounded = Math.round(clamped * 2) / 2;
    const full = Math.floor(rounded);
    const half = rounded - full === 0.5;
    const empty = 5 - full - (half ? 1 : 0);
    return (
        <span className="flex items-center gap-0.5">
            {Array.from({ length: full }).map((_, i) => (
                <Star key={`f${i}`} size={size} className="text-yellow-400 fill-yellow-400" />
            ))}
            {half && <Star size={size} className="text-yellow-400 fill-yellow-400/40" />}
            {Array.from({ length: empty }).map((_, i) => (
                <Star key={`e${i}`} size={size} className="text-text-tertiary/25 fill-transparent" />
            ))}
        </span>
    );
};
