import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Command, Monitor, Mic, Settings, Zap, Key, User, Play, Image, ArrowUp, FileText, Sparkles, Search, ChevronUp, Copy,
    FileJson, MessageSquare, Briefcase, Eye, EyeOff, Ghost, ChevronDown, ChevronRight, HelpCircle, Upload, CheckCircle2,
    RefreshCw, Trash2, Check, ExternalLink, Volume2, Globe, Brain, Cpu, Calendar, Star, CreditCard, X, Pencil, Lightbulb,
    SlidersHorizontal, PointerOff, ArrowRight, LayoutGrid
} from 'lucide-react';
import { SiOpenai, SiGoogle } from 'react-icons/si';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import nativelyIcon from '../icon.png';

// ----------------------
// Animations & Mocks
// ----------------------

export const MOCK_BUTTONS = [
    { icon: Pencil,        label: 'What to answer?',   kbd: '⌘1', color: 'blue'    },
    { icon: MessageSquare, label: 'Clarify',            kbd: '⌘2', color: 'indigo'  },
    { icon: RefreshCw,     label: 'Recap',              kbd: '⌘7', color: 'amber'   },
    { icon: HelpCircle,    label: 'Follow Up Question', kbd: '⌘4', color: 'teal'    },
    { icon: Zap,           label: 'Answer',             kbd: '⌘5', color: 'emerald' },
] as const;

export const colorMap: Record<string, string> = {
    blue:    'bg-blue-500/10 text-blue-500 border-blue-500/25',
    indigo:  'bg-indigo-500/10 text-indigo-400 border-indigo-500/25',
    amber:   'bg-amber-500/10 text-amber-500 border-amber-500/25',
    teal:    'bg-teal-500/10 text-teal-500 border-teal-500/25',
    emerald: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/25',
};

export const MockAppInterface = () => {
    const [activeBtn, setActiveBtn] = useState(0);
    const isLight = useResolvedTheme() === 'light';

    useEffect(() => {
        const id = setInterval(() => setActiveBtn(i => (i + 1) % MOCK_BUTTONS.length), 1600);
        return () => clearInterval(id);
    }, []);

    return (
        <div className="flex flex-col items-center w-full max-w-[600px] mx-auto opacity-100 relative h-[380px] overflow-hidden">
            <div className="flex flex-col items-center w-[600px] transform scale-[0.8] origin-top absolute top-0 pt-2">
                {/* Top Pill Replica */}
                <div className="flex justify-center mb-2 select-none z-50">
                    <div className="flex items-center gap-2 rounded-full backdrop-blur-md pl-1.5 pr-1.5 py-1.5 bg-bg-item-surface border border-border-subtle shadow-sm">
                        {/* Logo Button */}
                        <div className="w-8 h-8 rounded-full bg-bg-item-active flex items-center justify-center border border-border-muted overflow-hidden">
                            <img
                                src={nativelyIcon}
                                alt="Natively"
                                className="w-[20px] h-[20px] object-contain"
                                style={{ filter: isLight ? 'brightness(0)' : 'brightness(0) invert(1)', opacity: 0.9 }}
                            />
                        </div>
                        {/* Center Segment */}
                        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-bg-item-surface text-text-primary text-[12px] font-medium border border-border-muted">
                            <ChevronUp className="w-3.5 h-3.5 opacity-70" />
                            <span className="tracking-wide opacity-80">Hide</span>
                        </div>
                        {/* Stop Button */}
                        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-bg-item-active text-text-primary border border-border-muted">
                            <div className="w-3.5 h-3.5 rounded-[3px] bg-current opacity-80" />
                        </div>
                    </div>
                </div>

                {/* Main Window */}
                <div className="relative w-full backdrop-blur-[30px] border border-border-subtle rounded-[24px] overflow-hidden flex flex-col bg-bg-item-surface shadow-2xl">

                    {/* Rolling Transcript Bar — replica of RollingTranscript.tsx */}
                    <div className="relative w-[90%] mx-auto pt-2">
                        <div
                            className="overflow-hidden whitespace-nowrap text-right"
                            style={{ maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)' }}
                        >
                            <span className="text-text-secondary inline-flex items-center text-[13px] italic leading-7 opacity-60">
                                ...and I'd also consider a distributed cache layer for horizontal scaling
                                <span className="inline-flex items-center ml-2">
                                    <span className="w-1 h-1 bg-green-500/60 rounded-full animate-pulse" />
                                </span>
                            </span>
                        </div>
                    </div>

                    {/* Chat History */}
                    <div className="p-4 space-y-3 pb-2 flex-1 overflow-y-auto max-h-[220px]">
                        <div className="flex justify-start">
                            <div className="max-w-[85%] px-4 py-3 text-[14px] leading-relaxed font-normal text-text-primary">
                                <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium uppercase tracking-wider text-text-secondary opacity-70">
                                    Interviewer
                                </div>
                                <span className="text-text-secondary italic">So how would you optimize the current algorithm?</span>
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <div className="max-w-[72.25%] px-[13.6px] py-[10.2px] text-[14px] leading-relaxed whitespace-pre-wrap bg-blue-500/10 border border-blue-500/20 text-blue-500 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium">
                                <span className="font-semibold text-emerald-500 block mb-1 text-[12px]">🎯 Answer</span>
                                A good approach would be to use a hash map to cache intermediate results and reduce time complexity to O(N).
                            </div>
                        </div>
                    </div>

                    {/* Quick Actions — cycling highlight */}
                    <div className="flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 pt-3 overflow-x-hidden">
                        {MOCK_BUTTONS.map((btn, idx) => {
                            const Icon = btn.icon;
                            const isActive = activeBtn === idx;
                            return (
                                <button key={idx} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all duration-300 whitespace-nowrap shrink-0 ${isActive ? colorMap[btn.color] : 'bg-bg-item-surface text-text-primary border-border-subtle'}`}>
                                    <Icon className="w-3 h-3 opacity-70" /> {btn.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Input Area */}
                    <div className="p-3 pt-0">
                        <div className="relative">
                            <div className="w-full border border-border-subtle rounded-xl pl-3 pr-10 py-2.5 text-[13px] leading-relaxed bg-bg-input shadow-inner flex items-center h-[46px]">
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[13px] text-text-secondary opacity-60">
                                    <span className="hidden sm:inline">Ask anything on screen or conversation, or</span>
                                    <div className="flex items-center gap-1 opacity-80 sm:ml-0.5">
                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center bg-bg-item-surface border-border-subtle text-text-primary shadow-sm">⌘</kbd>
                                        <span className="text-[10px]">+</span>
                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center bg-bg-item-surface border-border-subtle text-text-primary shadow-sm">⇧</kbd>
                                        <span className="text-[10px]">+</span>
                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center bg-bg-item-surface border-border-subtle text-text-primary shadow-sm">H</kbd>
                                    </div>
                                    <span className="hidden sm:inline">for selective screenshot</span>
                                </div>
                            </div>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-20 text-text-primary">
                                <span className="text-[10px]">↵</span>
                            </div>
                        </div>
                        {/* Bottom Row */}
                        <div className="flex items-center justify-between mt-3 px-0.5">
                            <div className="flex items-center gap-1.5">
                                <button className="flex items-center gap-2 px-3 py-1.5 border border-border-subtle rounded-lg bg-bg-item-surface text-text-primary text-xs font-medium w-[140px] shadow-sm">
                                    <span className="truncate min-w-0 flex-1 text-left">Gemini 3.1 Flash</span>
                                    <ChevronDown size={14} className="shrink-0 opacity-70" />
                                </button>
                                <div className="h-3 w-px bg-border-subtle mx-1" />
                                <button className="w-8 h-8 flex items-center justify-center border border-border-subtle rounded-lg bg-bg-item-surface text-text-primary shadow-sm">
                                    <SlidersHorizontal size={14} className="opacity-70" />
                                </button>
                                <div className="h-3 w-px bg-border-subtle mx-1" />
                                <button className="w-8 h-8 flex items-center justify-center border border-border-subtle rounded-lg bg-bg-item-surface text-text-primary shadow-sm">
                                    <PointerOff size={14} className="opacity-70" />
                                </button>
                            </div>
                            <button className="w-7 h-7 rounded-full flex items-center justify-center bg-bg-item-surface border border-border-subtle shadow-sm text-text-secondary">
                                <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const MockMeetingInterfaceAnim = () => {
    const [tab, setTab] = useState('summary');

    useEffect(() => {
        const tabs = ['summary', 'transcript', 'usage'];
        let i = 0;
        const interval = setInterval(() => { i = (i + 1) % tabs.length; setTab(tabs[i]); }, 3500);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="w-full aspect-[3/2] bg-bg-secondary rounded-[20px] border border-border-subtle overflow-hidden flex flex-col relative shadow-lg select-none pointer-events-none">

            {/* Header */}
            <div className="px-6 pt-5 pb-0 shrink-0">
                <div className="text-xs text-text-tertiary font-medium mb-0.5">Today · 47 min</div>
                <h1 className="text-xl font-bold text-text-primary tracking-tight">System Design Interview</h1>
            </div>

            {/* Tabs row */}
            <div className="flex items-center justify-between px-6 pt-4 pb-3 shrink-0">
                <div className="p-1 rounded-xl inline-flex items-center gap-0.5 bg-bg-input border border-border-subtle">
                    {['summary', 'transcript', 'usage'].map((t) => (
                        <button key={t} className={`relative px-3 py-1 text-[12px] font-medium rounded-lg z-10 transition-colors ${tab === t ? 'text-text-primary bg-bg-elevated shadow-sm border border-border-subtle' : 'text-text-tertiary'}`}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary opacity-70">
                    <Copy size={12} /> Copy full {tab}
                </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden px-6 pb-14">
                <AnimatePresence mode="wait">
                    {tab === 'summary' && (
                        <motion.div key="summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                            {/* Overview — plain paragraph + border-b, matches MeetingDetails prose block */}
                            <div className="mb-5 pb-5 border-b border-border-subtle">
                                <p className="text-sm text-text-secondary leading-relaxed">Discussed microservice architecture for the new payment gateway. Analyzed Redis vs Memcached for caching with a focus on data persistence to prevent race conditions during checkout.</p>
                            </div>
                            {/* Action Items — h2 heading + dot-bullet list, matches MeetingDetails exactly */}
                            <section className="mb-6">
                                <h2 className="text-base font-semibold text-text-primary mb-3">Action Items</h2>
                                <ul className="space-y-3">
                                    {['Draft Redis implementation constraints doc.', 'Schedule follow-up on Memcached benchmarks.'].map((item, i) => (
                                        <li key={i} className="flex items-start gap-3">
                                            <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0" />
                                            <p className="text-sm text-text-secondary leading-relaxed">{item}</p>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                            {/* Key Points */}
                            <section>
                                <h2 className="text-base font-semibold text-text-primary mb-3">Key Points</h2>
                                <ul className="space-y-3">
                                    {['Redis chosen for sorted set support enabling O(log N) rate limiting.', 'Horizontal scaling via distributed cache layer discussed.'].map((item, i) => (
                                        <li key={i} className="flex items-start gap-3">
                                            <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0" />
                                            <p className="text-sm text-text-secondary leading-relaxed">{item}</p>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        </motion.div>
                    )}
                    {tab === 'transcript' && (
                        <motion.div key="transcript" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-6">
                            {/* Matches MeetingDetails: speaker + timestamp inline, then text below — no card/border */}
                            {[
                                { speaker: 'Them', time: '10:32', text: 'Why did you use Redis over Memcached for the cart session?' },
                                { speaker: 'Me',   time: '10:33', text: 'Because we needed sorted sets for rate limiting and automatic expiry without custom cron jobs.' },
                            ].map((entry, i) => (
                                <div key={i}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-semibold text-text-secondary">{entry.speaker}</span>
                                        <span className="text-xs text-text-tertiary font-mono">{entry.time}</span>
                                    </div>
                                    <p className="text-text-secondary text-sm leading-relaxed">{entry.text}</p>
                                </div>
                            ))}
                        </motion.div>
                    )}
                    {tab === 'usage' && (
                        <motion.div key="usage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="space-y-4">
                            <div className="flex justify-end pt-2">
                                <div className="bg-accent-primary text-white px-4 py-2 rounded-2xl rounded-tr-sm max-w-[75%] text-xs leading-relaxed shadow-sm">
                                    Could you elaborate on the Redis rate limiting?
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 w-5 h-5 rounded-full bg-bg-input flex items-center justify-center border border-border-subtle shrink-0">
                                    <img src={nativelyIcon} alt="AI" className="w-3 h-3 opacity-50 object-contain force-black-icon" />
                                </div>
                                <div>
                                    <div className="text-[10px] text-text-tertiary mb-1 font-medium">10:35 AM</div>
                                    <p className="text-xs text-text-secondary leading-relaxed">You mentioned Redis Sorted Sets for the sliding rate window — efficient because it auto-expires stale records while keeping operations strictly O(log N).</p>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Floating ask bar */}
            <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-center">
                <div className="w-full max-w-[440px] flex items-center relative">
                    <div className="w-full pl-4 pr-11 py-2.5 bg-bg-item-surface shadow-sm border border-border-subtle rounded-full text-xs text-text-tertiary/70">Ask about this meeting...</div>
                    <div className="absolute right-2 p-1.5 rounded-full bg-bg-item-active text-text-primary border border-border-subtle shadow-sm">
                        <ArrowUp size={13} className="rotate-45" />
                    </div>
                </div>
            </div>
        </div>
    );
};

export const MockMeetingChatAnim = () => {
    return (
        <div className="w-full bg-bg-secondary rounded-[20px] border border-border-subtle overflow-hidden flex flex-col select-none pointer-events-none shadow-lg max-h-[280px]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
                <div className="flex items-center gap-2 text-text-tertiary">
                    <img src={nativelyIcon} className="w-3.5 h-3.5 force-black-icon opacity-50" alt="logo" />
                    <span className="text-[13px] font-medium">Search this meeting</span>
                </div>
                <X size={16} className="text-text-tertiary" />
            </div>

            {/* Messages */}
            <div className="p-5 space-y-5">
                <div className="flex justify-end">
                    <div className="bg-accent-primary text-white px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[75%] text-sm leading-relaxed shadow-sm">
                        What API dependencies did they mention?
                    </div>
                </div>
                <div className="flex flex-col items-start">
                    <p className="text-sm text-text-primary leading-relaxed max-w-[85%]">
                        Based on the transcript near 10:45 AM, they explicitly mentioned integrating <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-[12px] font-mono text-text-primary border border-border-subtle">Stripe Payment Intents</code> to handle the recurring tier logic securely.
                    </p>
                    <div className="flex items-center gap-2 mt-2.5 text-xs text-text-tertiary">
                        <Copy size={13} /> Copy message
                    </div>
                </div>
            </div>
        </div>
    );
};

export const MockSearchPillAnim = () => {
    const isLight = useResolvedTheme() === 'light';
    return (
        <div className="flex justify-center flex-col items-center py-10 rounded-[26px] border border-border-subtle relative overflow-hidden h-[340px] bg-bg-card">
            <div className="absolute inset-0 bg-black/5 backdrop-blur-[2px]" />
            <motion.div 
                 initial={{ y: -10, opacity: 0, scale: 0.95 }}
                 animate={{ y: 0, opacity: 1, scale: 1 }}
                 className={`w-[480px] ${isLight ? 'bg-[#F2F2F7]/90' : 'bg-[#161618]/90'} backdrop-blur-xl backdrop-saturate-150 rounded-2xl shadow-md overflow-hidden z-10 transform-gpu relative border border-border-subtle`}
             >
                 {/* Input Row */}
                 <div className="relative flex items-center border-b border-border-muted">
                     <div className="absolute left-3 flex items-center pointer-events-none">
                         <Search size={14} className="text-text-tertiary" />
                     </div>
                     <div className="w-full bg-transparent pl-9 pr-4 py-2.5 text-[13px] text-text-primary outline-none flex items-center h-[38px]">
                        <span className="opacity-90">System</span><motion.span animate={{ opacity: [1, 0, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-[1.5px] h-3.5 bg-blue-500 ml-[2px] inline-block" />
                     </div>
                 </div>

                 {/* Results Panel mock */}
                 <div className="w-[480px]">
                     <div className="py-2">
                         {/* Explore Section */}
                         <div className="px-3 py-1">
                             <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                                 Explore
                             </div>

                             <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left bg-bg-item-active transition-colors">
                                 <div className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
                                     <Sparkles size={12} className="text-white" />
                                 </div>
                                 <span className="text-[13px] text-text-primary truncate">
                                     System
                                 </span>
                             </div>

                             <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-bg-item-hover transition-colors">
                                 <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0 border border-border-subtle">
                                     <Search size={12} className="text-text-secondary" />
                                 </div>
                                 <span className="text-[13px] text-text-secondary">
                                     Search for <span className="text-text-primary">"System"</span>
                                 </span>
                             </div>
                         </div>

                         {/* Sessions Section */}
                         <div className="px-3 py-1 mt-1">
                             <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                                 Sessions
                             </div>

                             <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-bg-item-hover transition-colors">
                                 <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0 border border-border-subtle">
                                     <FileText size={12} className="text-text-secondary" />
                                 </div>
                                 <div className="flex-1 min-w-0">
                                     <div className="text-[13px] text-text-primary truncate">
                                         System Design Interview
                                     </div>
                                     <div className="text-[11px] text-text-tertiary">
                                         Jan 12
                                     </div>
                                 </div>
                             </div>
                             
                             <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-bg-item-hover transition-colors">
                                 <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0 border border-border-subtle">
                                     <FileText size={12} className="text-text-secondary" />
                                 </div>
                                 <div className="flex-1 min-w-0">
                                     <div className="text-[13px] text-text-primary truncate">
                                         System Architecture Sync
                                     </div>
                                     <div className="text-[11px] text-text-tertiary">
                                         Jan 08
                                     </div>
                                 </div>
                             </div>
                         </div>
                     </div>
                 </div>
            </motion.div>
        </div>
    );
};

export const MockPermissionsAnim = () => {
    const [toggled, setToggled] = useState(false);
    useEffect(() => {
        const i = setInterval(() => setToggled(t => !t), 2500);
        return () => clearInterval(i);
    }, []);

    return (
        <div className="flex justify-center flex-col items-center gap-4 py-8 bg-bg-card rounded-xl border border-border-subtle relative overflow-hidden h-[240px]">
             <div className="w-[300px] bg-bg-elevated border border-border-subtle rounded-xl shadow-lg p-4 z-10">
                <div className="flex items-center gap-3 mb-4 border-b border-border-subtle pb-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center">
                        <Monitor className="w-4 h-4" />
                    </div>
                    <div className="font-semibold text-sm text-text-primary">Screen Recording</div>
                </div>
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <img src={nativelyIcon} alt="Natively" className="w-6 h-6 object-contain rounded drop-shadow-sm opacity-90" />
                        <span className="text-text-primary text-sm font-medium">Natively</span>
                    </div>
                    
                    <motion.div 
                        initial={false}
                        animate={{ backgroundColor: toggled ? '#3b82f6' : 'var(--bg-toggle-switch)' }}
                        className="w-10 h-6 rounded-full relative shadow-inner"
                    >
                        <motion.div 
                            initial={false}
                            animate={{ x: toggled ? 18 : 2 }}
                            className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                        />
                    </motion.div>
                </div>
            </div>
            <div className="text-xs text-text-secondary text-center max-w-[280px]">
                Natively requires Accessibility and Screen Recording permissions to analyze screen context.
            </div>
        </div>
    );
};

export const MockPillControlsAnim = () => {
    const [windowShowing, setWindowShowing] = useState(true);

    useEffect(() => {
        const interval = setInterval(() => setWindowShowing(prev => !prev), 2400);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="mt-4 space-y-2.5">
            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider px-1 mb-3">Pill Controls</div>

            {/* Logo → Launcher */}
            <div className="flex items-center gap-3 p-3 bg-bg-elevated border border-border-subtle rounded-xl">
                <div className="w-8 h-8 rounded-full bg-bg-item-active flex items-center justify-center border border-border-muted shrink-0 shadow-sm">
                    <img src={nativelyIcon} alt="Logo" className="w-[18px] h-[18px] object-contain force-black-icon opacity-90" />
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <motion.div
                        animate={{ opacity: [0.7, 1, 0.7] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 shrink-0"
                    >
                        <span className="relative flex h-[7px] w-[7px] shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                            <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-emerald-400" />
                        </span>
                        <span className="text-[11px] font-medium text-emerald-500">Meeting ongoing</span>
                    </motion.div>
                    <span className="text-[11px] text-text-secondary leading-snug">— clicking this brings you right back</span>
                </div>
            </div>

            {/* Hide / Show toggle */}
            <div className="flex items-center gap-3 p-3 bg-bg-elevated border border-border-subtle rounded-xl">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-item-active border border-border-muted shrink-0 w-[68px]">
                    <motion.div animate={{ rotate: windowShowing ? 0 : 180 }} transition={{ duration: 0.35, ease: 'easeInOut' }}>
                        <ChevronUp className="w-3 h-3 text-text-secondary" />
                    </motion.div>
                    <span className="text-[11px] text-text-secondary font-medium">{windowShowing ? 'Hide' : 'Show'}</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="relative w-14 h-9 shrink-0">
                        <motion.div
                            animate={{ opacity: windowShowing ? 1 : 0 }}
                            transition={{ duration: 0.35 }}
                            className="absolute inset-0 rounded-lg border border-border-subtle bg-bg-item-surface flex items-center justify-center"
                        >
                            <Eye className="w-3.5 h-3.5 text-text-tertiary" />
                        </motion.div>
                        <motion.div
                            animate={{ opacity: windowShowing ? 0 : 0.4 }}
                            transition={{ duration: 0.35 }}
                            className="absolute inset-0 rounded-lg border border-dashed border-border-subtle flex items-center justify-center"
                        >
                            <EyeOff className="w-3.5 h-3.5 text-text-tertiary" />
                        </motion.div>
                    </div>
                    <span className="text-[11px] text-text-secondary leading-snug">Toggles entire window — keeps you <strong className="text-text-primary">purely stealth</strong></span>
                </div>
            </div>

            {/* Stop → end session */}
            <div className="flex items-center gap-3 p-3 bg-bg-elevated border border-border-subtle rounded-xl">
                <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center shrink-0">
                    <div className="w-3 h-3 rounded-[2.5px] bg-red-400" />
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <motion.span
                        animate={{ opacity: [1, 0.25, 1] }}
                        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                        className="text-[11px] text-red-400 font-medium shrink-0"
                    >
                        Session ends instantly
                    </motion.span>
                    <span className="text-[11px] text-text-tertiary">— returns to launcher</span>
                </div>
            </div>

        </div>
    );
};

export const MockFastModeAnim = () => {
    return (
        <div className="flex justify-center items-center py-8 bg-bg-card rounded-xl border border-border-subtle relative overflow-hidden h-[240px]">
            <div className="flex flex-col items-center gap-4 z-10">
                <motion.div 
                    className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center shadow-[0_0_30px_rgba(249,115,22,0.4)]"
                    animate={{ rotate: 360 }}
                    transition={{ ease: "linear", duration: 8, repeat: Infinity }}
                >
                    <Zap className="w-8 h-8 text-white" />
                </motion.div>
                <div className="text-center">
                    <div className="font-bold text-lg text-text-primary">Fast Mode Enabled</div>
                    <div className="text-xs text-text-secondary mt-1">Routing via Groq LPU (Response &lt; 0.5s)</div>
                </div>
            </div>
            
            {/* Background pulses */}
            <motion.div 
                className="absolute inset-0 border-[6px] border-orange-500/20 rounded-xl"
                animate={{ scale: [1, 1.05, 1], opacity: [0, 1, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
            />
        </div>
    );
};

// Audio Mock Animations

export const getBadgeStyle = (color?: string) => {
    switch (color) {
        case 'blue': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
        case 'orange': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
        case 'purple': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
        case 'teal': return 'bg-teal-500/10 text-teal-500 border-teal-500/20';
        case 'cyan': return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
        case 'indigo': return 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20';
        case 'green': return 'bg-green-500/10 text-green-500 border-green-500/20';
        default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
};

export const getIconStyle = (color?: string, isSelectedItem: boolean = false) => {
    if (isSelectedItem) return 'bg-accent-primary text-white shadow-sm';
    switch (color) {
        case 'blue': return 'bg-blue-500/10 text-blue-600';
        case 'orange': return 'bg-orange-500/10 text-orange-600';
        case 'purple': return 'bg-purple-500/10 text-purple-600';
        case 'teal': return 'bg-teal-500/10 text-teal-600';
        case 'cyan': return 'bg-cyan-500/10 text-cyan-600';
        case 'indigo': return 'bg-indigo-500/10 text-indigo-600';
        case 'green': return 'bg-green-500/10 text-green-600';
        default: return 'bg-gray-500/10 text-gray-600';
    }
};

export const MockProviderSelectionAnim = () => {
    const isLight = useResolvedTheme() === 'light';
    const [isOpen, setIsOpen] = useState(false);
    useEffect(() => {
        const i = setInterval(() => setIsOpen(o => !o), 4000);
        return () => clearInterval(i);
    }, []);

    const options = [
        { id: 'natively', label: 'Natively API', badge: '', recommended: true, desc: 'Ultra-fast low latency transcription', color: 'indigo', icon: <img src={nativelyIcon} className={`w-[14px] h-[14px] object-contain opacity-80 ${isLight ? '' : 'filter brightness-0 invert'}`} alt="Natively"/> },
        { id: 'deepgram', label: 'Deepgram Nova-3', badge: 'Saved', recommended: false, desc: 'High-accuracy REST transcription', color: 'purple', icon: <Mic size={14} /> },
        { id: 'google', label: 'Google Cloud', badge: 'Saved', recommended: false, desc: 'gRPC streaming via Service Account', color: 'blue', icon: <Mic size={14} /> },
        { id: 'groq', label: 'Groq Whisper', badge: '', recommended: false, desc: 'Fast LPU whisper transcription', color: 'orange', icon: <Mic size={14} /> },
        { id: 'azure', label: 'Azure Speech', badge: '', recommended: false, desc: 'Enterprise tier transcription', color: 'teal', icon: <Mic size={14} /> },
        { id: 'soniox', label: 'Soniox', badge: '', recommended: false, desc: 'Medical-grade transcription', color: 'cyan', icon: <Mic size={14} /> },
        { id: 'ibm', label: 'IBM Watson', badge: '', recommended: false, desc: 'Watson Speech-to-Text', color: 'indigo', icon: <Mic size={14} /> },
    ];
    const selected = options[0];

    return (
        <div className="flex justify-center flex-col items-center py-6 bg-bg-card rounded-xl border border-border-subtle relative overflow-hidden h-[300px]">
             <div className="w-[340px] flex flex-col gap-2 relative z-10 font-sans">
                <label className="text-xs font-medium text-text-secondary">Speech Provider</label>
                <div className="relative">
                    <button className={`w-full group bg-bg-input border border-border-subtle shadow-sm rounded-xl p-2.5 pr-3.5 flex items-center justify-between transition-all duration-200 outline-none ${isOpen ? 'ring-2 ring-accent-primary/20 border-accent-primary/50' : 'hover:shadow-md'}`}>
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 transition-all duration-300 transform ${getIconStyle(selected.color, false)}`}>
                                {selected.icon}
                            </div>
                            <div className="min-w-0 flex-1 text-left">
                                <div className="flex items-center gap-2">
                                    <span className="text-[13px] font-semibold text-text-primary truncate leading-tight">{selected.label}</span>
                                    {selected.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ml-2 ${getBadgeStyle('green')}`}>{selected.badge}</span>}
                                    {selected.recommended && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ml-2 ${getBadgeStyle(selected.color)}`}>Recommended</span>}
                                </div>
                                <span className="text-[11px] text-text-tertiary truncate block leading-tight mt-0.5">{selected.desc}</span>
                            </div>
                        </div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-text-tertiary transition-transform duration-300 group-hover:bg-bg-input ${isOpen ? 'rotate-180 bg-bg-input text-text-primary' : ''}`}>
                            <ChevronDown size={14} strokeWidth={2.5} />
                        </div>
                    </button>

                    <AnimatePresence>
                        {isOpen && (
                            <motion.div
                                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                                transition={{ duration: 0.15, ease: "easeOut" }}
                                className={"absolute top-full left-0 w-full mt-2 backdrop-blur-xl rounded-xl shadow-2xl overflow-hidden z-20 bg-bg-elevated border border-border-subtle"}
                            >
                                 <div className="max-h-[170px] overflow-hidden relative" style={{ WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)' }}>
                                    <motion.div 
                                        className="p-1.5 space-y-0.5"
                                        animate={{ y: [0, 0, -110, -110, 0, 0] }}
                                        transition={{ duration: 3.5, ease: "easeInOut", repeat: Infinity }}
                                    >
                                        {options.map((option) => {
                                            const isSelected = selected.id === option.id;
                                            return (
                                                <div key={option.id} className={`w-full rounded-[10px] p-2 flex items-center gap-3 transition-all duration-200 group relative cursor-pointer ${isSelected ? 'bg-bg-item-active shadow-inner' : 'hover:bg-bg-item-hover'}`}>
                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 ${isSelected ? 'scale-100' : 'scale-95 group-hover:scale-100'} ${getIconStyle(option.color, false)}`}>
                                                        {option.icon}
                                                    </div>
                                                    <div className="flex-1 min-w-0 text-left">
                                                        <div className="flex items-center justify-between mb-0.5">
                                                            <div className="flex items-center gap-2">
                                                                <span className={"text-[13px] font-medium transition-colors text-text-primary"}>{option.label}</span>
                                                                {option.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle('green')}`}>{option.badge}</span>}
                                                                {option.recommended && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle(option.color)}`}>Recommended</span>}
                                                            </div>
                                                            {isSelected && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}><Check size={14} className="text-accent-primary" strokeWidth={3} /></motion.div>}
                                                        </div>
                                                        <span className={"text-[11px] block truncate transition-colors text-text-secondary"}>{option.desc}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </motion.div>
                                 </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
            
            {/* Animated Cursor */}
            <motion.div 
                className="absolute w-5 h-5 z-30 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                animate={{ 
                    x: isOpen ? 100 : 150,
                    y: isOpen ? 80 : 30
                }}
                transition={{ duration: 1.2, ease: 'easeInOut' }}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="black" strokeWidth="1.5"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.42c.45 0 .67-.54.35-.85L6.35 3.35a.5.5 0 0 0-.85.35Z"/></svg>
            </motion.div>
        </div>
    );
};

export const MockApiKeyFlowAnim = () => {
    const [stage, setStage] = useState(0); // 0: enter key, 1: saving, 2: test, 3: connected, 4: trash
    useEffect(() => {
        const i = setInterval(() => setStage(s => (s + 1) % 5), 2000);
        return () => clearInterval(i);
    }, []);

    return (
        <div className="flex justify-center flex-col items-center gap-2 py-8 bg-bg-card rounded-xl border border-border-subtle relative overflow-hidden h-[240px]">
             <div className="w-[380px] space-y-2 relative z-10">
                <label className="text-xs font-medium text-text-secondary block">Groq API Key</label>
                <div className="flex gap-2">
                    <div className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary flex items-center shadow-inner">
                        <span className={stage > 0 ? "opacity-100" : "opacity-40"}>
                            {stage > 0 ? "gsk_a8B2c..." : "Enter API key"}
                        </span>
                        {stage === 0 && <motion.div animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-0.5 h-4 bg-accent-primary ml-0.5" />}
                    </div>
                    <div className="px-5 py-2 rounded-lg text-xs font-medium bg-bg-elevated border border-border-subtle flex items-center justify-center transition-colors shadow-sm">
                        {stage === 1 ? <Check size={14} className="text-green-500" /> : 'Save'}
                    </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-3">
                        <div className="text-xs bg-bg-input px-3 py-1.5 rounded-md flex items-center gap-2 border border-border-subtle shadow-sm">
                            {stage === 2 ? <RefreshCw size={12} className="text-blue-500 animate-spin" /> : stage > 2 ? <Check size={12} className="text-green-500" /> : <Play size={12} className="text-text-tertiary" />}
                            <span className={stage > 2 ? "text-green-500" : "text-text-primary"}>
                                {stage === 2 ? 'Testing...' : stage > 2 ? 'Connected' : 'Test API Key'}
                            </span>
                        </div>
                    </div>
                    <div className={`p-2 rounded-lg ${stage === 4 ? 'bg-red-500/20 text-red-500' : 'text-text-tertiary'} border border-transparent`}>
                        <Trash2 size={16} />
                    </div>
                </div>
             </div>
             
             {/* Animated Cursor */}
            <motion.div 
                className="absolute w-5 h-5 z-20 drop-shadow-lg"
                animate={{ 
                    x: stage === 0 ? 0 : stage === 1 ? 140 : stage === 2 ? -80 : stage === 4 ? 170 : 170,
                    y: stage === 0 ? 20 : stage === 1 ? 20 : stage === 2 ? 65 : stage === 4 ? 65 : 65
                }}
                transition={{ duration: 0.5, ease: 'easeInOut' }}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="black" strokeWidth="1.5"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.42c.45 0 .67-.54.35-.85L6.35 3.35a.5.5 0 0 0-.85.35Z"/></svg>
            </motion.div>
        </div>
    );
};

export const ElevenLabsPermissionsMock = () => {
    return (
        <div className="w-full flex justify-center py-4 bg-bg-elevated rounded-xl border border-border-subtle mb-3 mt-2 shadow-sm">
             <div className="flex items-center justify-between w-full max-w-[360px]">
                <span className="text-[14.5px] text-text-primary font-medium tracking-tight">Speech to Text</span>
                <div className="flex items-center bg-bg-main p-[3px] rounded-lg border border-border-subtle shadow-inner">
                    <div className="px-3.5 py-1.5 text-[13px] font-medium text-text-secondary">No Access</div>
                    <div className="px-3.5 py-1.5 text-[13px] font-medium text-black bg-white rounded-md shadow-sm relative z-10 before:absolute before:inset-0 before:rounded-md before:border-[1.5px] before:border-black before:opacity-90 before:-m-[1px]">Access</div>
                </div>
            </div>
        </div>
    );
};

// ----------------------
// Reusable Components
// ----------------------

export interface AccordionSectionProps {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

export const AccordionSection: React.FC<AccordionSectionProps> = ({ title, icon, children, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className={`border rounded-xl mb-4 overflow-hidden transition-all duration-200 bg-bg-card border-border-subtle shadow-sm`}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between p-4 transition-colors hover:bg-bg-item-surface group`}
            >
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-bg-item-surface border border-border-subtle group-hover:border-border-muted transition-colors text-text-secondary`}>
                        {icon}
                    </div>
                    <span className={`font-semibold text-sm text-text-primary`}>{title}</span>
                </div>
                {isOpen ? <ChevronDown className="w-5 h-5 text-text-tertiary" /> : <ChevronRight className="w-5 h-5 text-text-tertiary" />}
            </button>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                        <div className={`p-5 border-t border-border-subtle text-sm leading-relaxed text-text-secondary`}>
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export const SetupGuide = () => {
    const steps = [
        {
            title: 'Grant Permissions',
            desc: 'Enable Screen Recording and Accessibility for Natively in macOS Privacy & Security.',
        },
        {
            title: 'Set Up Audio',
            desc: 'Open Settings → Audio and select Natively API, or paste a Deepgram or Google key.',
        },
        {
            title: 'Connect an AI Model',
            desc: 'Open Settings → AI Providers and choose a built-in model, or add a Groq or OpenRouter key.',
        },
        {
            title: "You're all set.",
            desc: null,
        },
    ];

    const hotkeys = [
        { label: 'Toggle', kbd: '⌘H' },
        { label: 'Screenshot', kbd: '⌘⇧H' },
        { label: 'Chat', kbd: '⌘K' },
    ];

    return (
        <div className="mb-10">
            <div className="mb-7">
                <h3 className="text-[20px] font-bold text-text-primary tracking-tight leading-tight">Quick Start</h3>
                <p className="text-[13px] text-text-tertiary mt-0.5">Get Natively running in four steps.</p>
            </div>

            <div>
                {steps.map((step, i) => {
                    const isLast = i === steps.length - 1;
                    return (
                        <div key={i} className="flex gap-4">
                            {/* Step indicator column */}
                            <div className="flex flex-col items-center shrink-0" style={{ width: 28 }}>
                                <div className="w-7 h-7 rounded-full bg-accent-primary flex items-center justify-center shrink-0">
                                    <span className="text-[11px] font-bold text-white leading-none">{i + 1}</span>
                                </div>
                                {!isLast && (
                                    <div className="w-px bg-border-subtle flex-1" style={{ minHeight: 32, marginTop: 5, marginBottom: 5 }} />
                                )}
                            </div>

                            {/* Content */}
                            <div className={`flex-1 min-w-0 ${isLast ? 'pb-0' : 'pb-6'}`} style={{ paddingTop: 3 }}>
                                <p className="text-[14px] font-semibold text-text-primary leading-snug">{step.title}</p>
                                {step.desc && (
                                    <p className="text-[13px] text-text-secondary leading-relaxed mt-0.5">{step.desc}</p>
                                )}
                                {isLast && (
                                    <div className="flex items-center gap-4 mt-3 flex-wrap">
                                        {hotkeys.map((h, hi) => (
                                            <React.Fragment key={h.kbd}>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[12px] text-text-secondary">{h.label}</span>
                                                    <kbd className="font-mono text-[11px] font-semibold text-text-primary bg-bg-item-surface border border-border-subtle rounded-md px-1.5 py-0.5 leading-none">{h.kbd}</kbd>
                                                </div>
                                                {hi < hotkeys.length - 1 && <span className="text-border-subtle text-[12px] select-none">·</span>}
                                            </React.Fragment>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
