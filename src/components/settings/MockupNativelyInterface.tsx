import React, { useMemo } from 'react';
import { ChevronUp, ChevronDown, Pencil, MessageSquare, RefreshCw, HelpCircle, Zap, SlidersHorizontal } from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { getOverlayAppearance } from '../../lib/overlayAppearance';
import icon from '../icon.png';

// MockupNativelyInterface — fake in-meeting widget for the opacity preview
export const MockupNativelyInterface: React.FC<{ opacity: number }> = ({ opacity }) => {
    const resolvedTheme = useResolvedTheme();
    const appearance = useMemo(
        () => getOverlayAppearance(opacity, resolvedTheme),
        [opacity, resolvedTheme]
    );

    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none bg-transparent">
                {/* NativelyInterface Widget — opacity controlled by the slider */}
                <div
                    id="mockup-natively-interface"
                    className="flex flex-col items-center pointer-events-none -mt-56"
                >
                    {/* TopPill Replica */}
                    <div className="flex justify-center mb-2 select-none z-50">
                        <div className="flex items-center gap-2 rounded-full overlay-pill-surface backdrop-blur-md pl-1.5 pr-1.5 py-1.5" style={appearance.pillStyle}>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden overlay-icon-surface" style={appearance.iconStyle}>
                                <img
                                    src={icon}
                                    alt="Natively"
                                    className="w-[24px] h-[24px] object-contain opacity-95 scale-105 force-black-icon"
                                    draggable="false"
                                />
                            </div>
                            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-medium border overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <ChevronUp className="w-3.5 h-3.5 opacity-70" />
                                <span className="opacity-80 tracking-wide">Hide</span>
                            </div>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center overlay-icon-surface overlay-text-primary" style={appearance.iconStyle}>
                                <div className="w-3.5 h-3.5 rounded-[3px] bg-red-400 opacity-80" />
                            </div>
                        </div>
                    </div>

                    {/* Main Interface Window Replica */}
                    <div className="relative w-[600px] max-w-full overlay-shell-surface overlay-text-primary backdrop-blur-2xl border rounded-[24px] overflow-hidden flex flex-col pt-2 pb-3" style={appearance.shellStyle}>

                        {/* Rolling Transcript Bar */}
                        <div className="w-full flex justify-center py-2 px-4 border-b mb-1 overlay-transcript-surface" style={appearance.transcriptStyle}>
                            <p className="text-[13px] truncate max-w-[90%] font-medium overlay-text-primary">
                                <span className={`${resolvedTheme === 'light' ? 'text-blue-700' : 'text-blue-400'} mr-2 font-semibold`}>Interviewer</span>
                                <span className="opacity-95">So how would you optimize the current algorithm?</span>
                            </p>
                        </div>

                        {/* Chat History Mock */}
                        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
                            <div className="flex justify-start">
                                <div className="max-w-[85%] px-4 py-3 text-[14px] leading-relaxed font-normal overlay-text-primary">
                                    <span className="font-semibold text-emerald-500 block mb-1">Suggestion</span>
                                    A good approach would be to use a hash map to cache the intermediate results, which brings the time complexity down from O(n²) to O(n).
                                </div>
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 pt-3">
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <Pencil className="w-3 h-3 opacity-70" /> What to answer?
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <MessageSquare className="w-3 h-3 opacity-70" /> Clarify
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <RefreshCw className="w-3 h-3 opacity-70" /> Recap
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <HelpCircle className="w-3 h-3 opacity-70" /> Follow Up Question
                            </div>
                            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium min-w-[74px] shrink-0 border overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                                <Zap className="w-3 h-3 opacity-70" /> Answer
                            </div>
                        </div>

                        {/* Input Area */}
                        <div className="px-3">
                            <div className="relative group">
                                <div className="w-full border rounded-xl pl-3 pr-10 py-2.5 h-[38px] flex items-center overlay-input-surface" style={appearance.inputStyle}>
                                    <span className="text-[13px] overlay-text-muted">Ask anything on screen or conversation</span>
                                </div>
                            </div>

                            {/* Bottom Row */}
                            <div className="flex items-center justify-between mt-3 px-0.5">
                                <div className="flex items-center gap-1.5">
                                    <div className="flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-medium w-[140px] overlay-control-surface overlay-text-interactive" style={appearance.controlStyle}>
                                        <span className="truncate min-w-0 flex-1">Gemini 3 Flash</span>
                                        <ChevronDown size={14} className="shrink-0" />
                                    </div>
                                    <div className="w-px h-3 mx-1" style={appearance.dividerStyle} />
                                    <div className="w-7 h-7 flex items-center justify-center rounded-lg overlay-icon-surface overlay-text-muted" style={appearance.iconStyle}>
                                        <SlidersHorizontal className="w-3.5 h-3.5" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
        </div>
    );
};
