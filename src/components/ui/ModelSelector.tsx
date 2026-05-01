import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Cloud } from 'lucide-react';
import { STANDARD_CLOUD_MODELS, prettifyModelId } from '../../utils/modelUtils';

interface ModelSelectorProps {
    currentModel: string;
    onSelectModel: (model: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ currentModel, onSelectModel }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [cloudModels, setCloudModels] = useState<{ id: string; name: string; desc: string }[]>([]);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        const loadData = async () => {
            try {
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                const cModels: { id: string; name: string; desc: string }[] = [];

                const claudeCfg = STANDARD_CLOUD_MODELS.claude;
                if (claudeCfg && claudeCfg.hasKeyCheck(creds)) {
                    claudeCfg.ids.forEach((id, i) => cModels.push({ id, name: claudeCfg.names[i], desc: claudeCfg.descs[i] }));
                    const pm = creds?.claudePreferredModel;
                    if (pm && !claudeCfg.ids.includes(pm)) {
                        cModels.push({ id: pm, name: prettifyModelId(pm), desc: 'Anthropic • Preferred' });
                    }
                }

                setCloudModels(cModels);
            } catch (e) {
                console.error("Failed to load models:", e);
            }
        };
        loadData();
    }, [isOpen]);

    const handleSelect = (model: string) => {
        onSelectModel(model);
        setIsOpen(false);
    };

    const getModelDisplayName = (model: string) => {
        if (model === 'claude-sonnet-4-6') return 'Sonnet 4.6';
        if (model === 'claude-haiku-4-5-20251001') return 'Haiku 4.5';

        const cloud = cloudModels.find(m => m.id === model);
        if (cloud) return cloud.name;

        return model;
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg transition-colors text-xs font-medium text-text-primary max-w-[150px]"
            >
                <span className="truncate">{getModelDisplayName(currentModel)}</span>
                <ChevronDown size={14} className={`shrink-0 text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-64 bg-bg-item-surface border border-border-subtle rounded-xl shadow-xl z-50 overflow-hidden animated fadeIn">
                    <div className="p-2 max-h-64 overflow-y-auto">
                        <div className="space-y-1">
                            {cloudModels.length === 0 ? (
                                <div className="text-center py-6 text-text-tertiary">
                                    <p className="text-xs mb-2">No Claude key configured.</p>
                                    <p className="text-[10px] opacity-70">Add a Claude API key in Settings.</p>
                                </div>
                            ) : (
                                cloudModels.map(m => (
                                    <ModelOption
                                        key={m.id}
                                        name={m.name}
                                        desc={m.desc}
                                        icon={<Cloud size={14} />}
                                        selected={currentModel === m.id}
                                        onSelect={() => handleSelect(m.id)}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

interface ModelOptionProps {
    name: string;
    desc: string;
    icon: React.ReactNode;
    selected: boolean;
    onSelect: () => void;
}

const ModelOption: React.FC<ModelOptionProps> = ({ name, desc, icon, selected, onSelect }) => (
    <button
        onClick={onSelect}
        className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors group ${selected ? 'bg-accent-primary/10' : 'hover:bg-bg-input'}`}
    >
        <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-md ${selected ? 'bg-accent-primary/20 text-accent-primary' : 'bg-bg-elevated text-text-secondary group-hover:text-text-primary'}`}>
                {icon}
            </div>
            <div className="text-left">
                <div className={`text-xs font-medium truncate max-w-[140px] ${selected ? 'text-accent-primary' : 'text-text-primary'}`}>{name}</div>
                <div className="text-[10px] text-text-tertiary">{desc}</div>
            </div>
        </div>
        {selected && <Check size={14} className="text-accent-primary" />}
    </button>
);
