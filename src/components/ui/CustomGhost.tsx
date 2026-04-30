import React from 'react';

interface CustomGhostProps {
    className?: string;
    fill?: string;
    stroke?: string;
    eyeColor?: string;
}

// Custom Ghost with dynamic eye color support
export const CustomGhost: React.FC<CustomGhostProps> = ({ className, fill, stroke, eyeColor }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={fill || "none"}
        stroke={stroke || "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        {/* Body */}
        <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
        {/* Eyes - No stroke, just fill */}
        <path
            d="M9 10h.01 M15 10h.01"
            stroke={eyeColor || "currentColor"}
            strokeWidth="2.5" // Slightly bolder for visibility
            fill="none"
        />
    </svg>
);
