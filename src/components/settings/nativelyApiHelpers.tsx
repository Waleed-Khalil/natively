import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────
export interface QuotaBucket { used: number; limit: number; remaining: number; }
export interface UsageData {
    plan: string;
    member_since: string;
    quota: {
        transcription: QuotaBucket;
        ai:            QuotaBucket;
        search:        QuotaBucket;
        resets_at:     string;
    };
}

export const PLAN_STANDARD_URL = 'https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl';
export const PLAN_PRO_URL      = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';
export const PLAN_MAX_URL      = 'https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf';
export const PLAN_ULTRA_URL    = 'https://checkout.dodopayments.com/buy/pdt_0NcM7rC2kAb69TFKsZnUU';

// ─── Quota bar ───────────────────────────────────────────────
export function QuotaBar({ label, icon: Icon, bucket, barColor }: {
    label:    string;
    icon:     React.ElementType;
    bucket:   QuotaBucket;
    barColor: string;
}) {
    const pct    = bucket.limit > 0 ? Math.min(100, (bucket.used / bucket.limit) * 100) : 0;
    const isHigh = pct >= 80;
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Icon size={12} className={isHigh ? 'text-amber-400' : 'text-text-tertiary'} strokeWidth={1.75} />
                    <span className="text-[12px] text-text-secondary">{label}</span>
                </div>
                <span className={`text-[12px] tabular-nums font-medium ${isHigh ? 'text-amber-400' : 'text-text-tertiary'}`}>
                    {bucket.used.toLocaleString()}<span className="font-normal text-text-tertiary/60"> / {bucket.limit.toLocaleString()}</span>
                </span>
            </div>
            <div className="h-[5px] w-full bg-bg-input rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${isHigh ? 'bg-amber-400' : barColor}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}

// ─── Trial countdown (live, ticks every 500ms) ───────────────
export function TrialCountdown({ expiresAt }: { expiresAt: string }) {
    const [remaining, setRemaining] = useState(() =>
        Math.max(0, new Date(expiresAt).getTime() - Date.now())
    );
    useEffect(() => {
        const id = setInterval(() => {
            setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
        }, 500);
        return () => clearInterval(id);
    }, [expiresAt]);
    const totalSec = Math.ceil(remaining / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const isWarning = remaining < 2 * 60 * 1000;
    return (
        <div className={`flex items-center gap-1 ${isWarning ? 'text-amber-400' : 'text-text-tertiary'}`}>
            <Clock size={11} strokeWidth={2} />
            <span className="text-[11px] font-mono font-semibold tabular-nums">
                {remaining === 0 ? 'Ended' : `${m}:${s.toString().padStart(2, '0')}`}
            </span>
        </div>
    );
}

// ─── Trial usage pill ─────────────────────────────────────────
export function TrialUsagePill({
    icon: Icon, used, limit, label, unit,
}: { icon: React.ElementType; used: number; limit: number; label: string; unit: string }) {
    const pct    = Math.min(100, (used / limit) * 100);
    const isHigh = pct >= 80;
    return (
        <div className="bg-bg-input rounded-[10px] px-3 py-2.5 space-y-2 border border-border-subtle">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <Icon size={12} strokeWidth={2} className={isHigh ? 'text-amber-400' : 'text-text-tertiary'} />
                    <span className="text-[10.5px] text-text-secondary font-medium">{label}</span>
                </div>
                <span className={`text-[12px] tabular-nums font-bold ${isHigh ? 'text-amber-400' : 'text-text-primary'}`}>
                    {used}<span className="text-[10px] font-medium text-text-tertiary">/{limit}{unit}</span>
                </span>
            </div>
            <div className="h-[4px] w-full bg-bg-surface rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${isHigh ? 'bg-amber-400' : 'bg-violet-500/70'}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}

// ─── Card wrapper ────────────────────────────────────────────
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`bg-bg-item-surface rounded-2xl border border-border-subtle overflow-hidden ${className}`}>
            {children}
        </div>
    );
}
