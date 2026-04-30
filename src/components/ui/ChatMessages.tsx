import React from 'react';
import { motion } from 'framer-motion';

export const TypingIndicator: React.FC = () => (
    <div className="flex items-center gap-1 py-4">
        <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className="w-2 h-2 rounded-full bg-text-tertiary"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        delay: i * 0.15,
                        ease: "easeInOut"
                    }}
                />
            ))}
        </div>
    </div>
);

interface UserMessageProps {
    content: string;
    /** Tailwind class for the bubble background (e.g. 'bg-accent-primary' or 'bg-[#2C2C2E]'). */
    bgClass?: string;
}

export const UserMessage: React.FC<UserMessageProps> = ({ content, bgClass = 'bg-accent-primary' }) => (
    <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="flex justify-end mb-6"
    >
        <div className={`${bgClass} text-white px-5 py-3 rounded-2xl rounded-tr-md max-w-[70%] text-[15px] leading-relaxed`}>
            {content}
        </div>
    </motion.div>
);
