import React from 'react';
import {
    RotateCcw, Eye, MessageSquare, Camera, Crop, Sparkles, RefreshCw, Mic, Zap,
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PointerOff,
} from 'lucide-react';
import { useShortcuts } from '../../hooks/useShortcuts';
import { KeyRecorder } from '../ui/KeyRecorder';

export const KeybindsSettings: React.FC = () => {
    const { shortcuts, updateShortcut, resetShortcuts } = useShortcuts();

    return (
        <div className="space-y-5 animated fadeIn select-text pb-4">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="text-lg font-bold text-text-primary mb-1">Keyboard shortcuts</h3>
                    <p className="text-xs text-text-secondary">Natively works with these easy to remember commands.</p>
                </div>
                <button
                    onClick={resetShortcuts}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle hover:border-green-500/30 transition-all duration-200 text-xs font-medium text-text-secondary hover:text-green-500 active:scale-95 mt-1"
                >
                    <RotateCcw size={13} strokeWidth={2.5} />
                    Restore Default
                </button>
            </div>

            <div className="grid gap-6">
                {/* General Category */}
                <div>
                    <h4 className="text-sm font-bold text-text-primary mb-3">General</h4>
                    <div className="space-y-1">
                        <div className="flex items-center justify-between py-1.5 group">
                            <div className="flex items-center gap-3">
                                <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Eye size={14} /></span>
                                <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Toggle Visibility</span>
                            </div>
                            <KeyRecorder
                                currentKeys={shortcuts.toggleVisibility}
                                onSave={(keys) => updateShortcut('toggleVisibility', keys)}
                            />
                        </div>
                        <div className="flex items-center justify-between py-1.5 group">
                            <div className="flex items-center gap-3">
                                <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><PointerOff size={14} /></span>
                                <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Toggle Mouse Passthrough</span>
                            </div>
                            <KeyRecorder
                                currentKeys={shortcuts.toggleMousePassthrough}
                                onSave={(keys) => updateShortcut('toggleMousePassthrough', keys)}
                            />
                        </div>
                        <div className="flex items-center justify-between py-1.5 group">
                            <div className="flex items-center gap-3">
                                <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><MessageSquare size={14} /></span>
                                <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Process Screenshots</span>
                            </div>
                            <KeyRecorder
                                currentKeys={shortcuts.processScreenshots}
                                onSave={(keys) => updateShortcut('processScreenshots', keys)}
                            />
                        </div>
                        <div className="flex items-center justify-between py-1.5 group">
                            <div className="flex items-center gap-3">
                                <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Sparkles size={14} /></span>
                                <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Capture Screen & Ask AI</span>
                            </div>
                            <KeyRecorder
                                currentKeys={shortcuts.captureAndProcess}
                                onSave={(keys) => updateShortcut('captureAndProcess', keys)}
                            />
                        </div>
                        <div className="flex items-center justify-between py-1.5 group">
                            <div className="flex items-center gap-3">
                                <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><RotateCcw size={14} /></span>
                                <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Reset / Cancel</span>
                            </div>
                            <KeyRecorder
                                currentKeys={shortcuts.resetCancel}
                                onSave={(keys) => updateShortcut('resetCancel', keys)}
                            />
                        </div>
                        <div className="flex items-center justify-between py-1.5 group">
                            <div className="flex items-center gap-3">
                                <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Camera size={14} /></span>
                                <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Take Screenshot</span>
                            </div>
                            <KeyRecorder
                                currentKeys={shortcuts.takeScreenshot}
                                onSave={(keys) => updateShortcut('takeScreenshot', keys)}
                            />
                        </div>
                        <div className="flex items-center justify-between py-1.5 group">
                            <div className="flex items-center gap-3">
                                <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Crop size={14} /></span>
                                <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Selective Screenshot</span>
                            </div>
                            <KeyRecorder
                                currentKeys={shortcuts.selectiveScreenshot}
                                onSave={(keys) => updateShortcut('selectiveScreenshot', keys)}
                            />
                        </div>
                    </div>
                </div>

                {/* Chat Category */}
                <div>
                    <div className="mb-3">
                        <h4 className="text-sm font-bold text-text-primary">Chat</h4>
                    </div>
                    <div className="space-y-1">
                        {[
                            { id: 'whatToAnswer', label: 'What to Answer', icon: <Sparkles size={14} /> },
                            { id: 'clarify', label: 'Clarify', icon: <MessageSquare size={14} /> },
                            { id: 'followUp', label: 'Follow Up', icon: <MessageSquare size={14} /> },
                            { id: 'dynamicAction4', label: 'Recap / Brainstorm', icon: <RefreshCw size={14} /> },
                            { id: 'answer', label: 'Answer / Record', icon: <Mic size={14} /> },
                            { id: 'codeHint', label: 'Get Code Hint', icon: <Zap size={14} /> },
                            { id: 'brainstorm', label: 'Brainstorm Approaches', icon: <Zap size={14} /> },
                            { id: 'scrollUp', label: 'Scroll Up', icon: <ArrowUp size={14} /> },
                            { id: 'scrollDown', label: 'Scroll Down', icon: <ArrowDown size={14} /> },
                        ].map((item, i) => (
                            <div key={i} className="flex items-center justify-between py-1.5 group">
                                <div className="flex items-center gap-3">
                                    <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center">{item.icon}</span>
                                    <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{item.label}</span>
                                </div>
                                <KeyRecorder
                                    currentKeys={shortcuts[item.id as keyof typeof shortcuts]}
                                    onSave={(keys) => updateShortcut(item.id as any, keys)}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Window Category */}
                <div>
                    <h4 className="text-sm font-bold text-text-primary mb-3">Window</h4>
                    <div className="space-y-1">
                        {[
                            { id: 'moveWindowUp', label: 'Move Window Up', icon: <ArrowUp size={14} /> },
                            { id: 'moveWindowDown', label: 'Move Window Down', icon: <ArrowDown size={14} /> },
                            { id: 'moveWindowLeft', label: 'Move Window Left', icon: <ArrowLeft size={14} /> },
                            { id: 'moveWindowRight', label: 'Move Window Right', icon: <ArrowRight size={14} /> }
                        ].map((item, i) => (
                            <div key={i} className="flex items-center justify-between py-1.5 group">
                                <div className="flex items-center gap-3">
                                    <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center">{item.icon}</span>
                                    <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{item.label}</span>
                                </div>
                                <KeyRecorder
                                    currentKeys={shortcuts[item.id as keyof typeof shortcuts]}
                                    onSave={(keys) => updateShortcut(item.id as any, keys)}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
