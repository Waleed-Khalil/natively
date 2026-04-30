// src/components/trial/FreeTrialModal.tsx
//
// Skills: ui-ux-pro-max · canvas-designer · frontend-design · ui-design-system
//
// Post-trial upgrade panel — Apple-grade dark glass card language.
// Plan cards follow Apple One / App Store subscription aesthetics:
// card-level hover lift + accent glow, benefit-oriented copy, single
// dominant CTA, trust footer — all tuned for maximum conversion.

import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { F, ChooseState, WipingState, DoneState } from './freeTrialCards';

const PLAN_STANDARD_URL = 'https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl';
const PLAN_PRO_URL      = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';
const PLAN_MAX_URL      = 'https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf';
const PLAN_ULTRA_URL    = 'https://checkout.dodopayments.com/buy/pdt_0NcM7rC2kAb69TFKsZnUU';


// ─────────────────────────────────────────────────────────────

interface TrialModalProps {
  usage:      { ai: number; stt_seconds: number; search: number };
  onByok:     () => Promise<void>;
  onStandard?: () => Promise<void>;
  onDone?:    () => void;
}

type Step = 'choose' | 'wiping' | 'done';

export const FreeTrialModal: React.FC<TrialModalProps> = ({ usage, onByok, onStandard, onDone }) => {
  const [step,  setStep]  = useState<Step>('choose');
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion() ?? false;

  const openUrl = (url: string) => (window.electronAPI as any)?.openExternal?.(url);

  const handleByok = async () => {
    setStep('wiping');
    setError(null);
    try   { await onByok(); setStep('done'); }
    catch (e: any) { setError(e.message || 'Something went wrong. Restart the app.'); setStep('choose'); }
  };

  return (
    <>
      <style>{`
        @keyframes fm-border {
          0%,100% { background-position:0% 50%; }
          50%      { background-position:100% 50%; }
        }
        .fm-ring {
          background: linear-gradient(145deg,rgba(139,92,246,.7),rgba(99,102,241,.52),rgba(139,92,246,.7));
          background-size:300% 300%;
          animation:fm-border 7s ease infinite;
        }
        .fm-ring-r { background:linear-gradient(145deg,rgba(139,92,246,.55),rgba(99,102,241,.4)); }
      `}</style>

      {/* Backdrop */}
      <div style={{
        position:'fixed', inset:0, zIndex:9999,
        display:'flex', alignItems:'center', justifyContent:'center',
        background:'radial-gradient(ellipse 80% 70% at 50% 50%,rgba(139,92,246,.07) 0%,rgba(0,0,0,.9) 100%)',
        backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)',
        fontFamily: F,
      } as React.CSSProperties}>

        {/* Iridescent ring */}
        <motion.div
          initial={reduced ? {opacity:0} : {opacity:0,scale:.95,y:20,filter:'blur(8px)'}}
          animate={reduced ? {opacity:1} : {opacity:1,scale:1,  y:0, filter:'blur(0px)'}}
          transition={{type:'spring',stiffness:280,damping:24,mass:.85}}
          className={reduced ? 'fm-ring-r' : 'fm-ring'}
          style={{padding:'1.5px',borderRadius:'24px',boxShadow:'0 56px 130px -24px rgba(0,0,0,.98),0 0 80px rgba(139,92,246,.05)'}}
        >
          {/* Card shell */}
          <div style={{
            position:'relative', width:'468px',
            borderRadius:'23px',
            background:'linear-gradient(158deg,rgba(12,9,22,.99) 0%,rgba(7,5,13,1) 100%)',
          }}>
            {/* Catch-light */}
            <div aria-hidden style={{position:'absolute',top:0,left:0,right:0,height:'1px',background:'rgba(255,255,255,.12)',pointerEvents:'none',zIndex:5}} />
            {/* Aurora pulse */}
            {!reduced && (
              <motion.div aria-hidden
                animate={{opacity:[.07,.16,.07]}}
                transition={{duration:7,repeat:Infinity,ease:'easeInOut'}}
                style={{position:'absolute',top:'-80px',left:'50%',transform:'translateX(-50%)',width:'440px',height:'280px',background:'radial-gradient(ellipse,rgba(139,92,246,.28) 0%,transparent 65%)',pointerEvents:'none',zIndex:1}}
              />
            )}
            {/* Grain */}
            <div aria-hidden style={{
              position:'absolute',inset:0,borderRadius:'23px',pointerEvents:'none',zIndex:4,
              opacity:.026,mixBlendMode:'overlay',
              backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize:'180px',
            }} />

            <div style={{padding:'22px 22px 24px',position:'relative',zIndex:6}}>
              {step==='wiping' && <WipingState />}
              {step==='done'   && <DoneState onDone={onDone} />}
              {step==='choose' && (
                <ChooseState
                  usage={usage} error={error} reduced={reduced}
                  onPro={()=>{ window.electronAPI?.convertTrial?.('pro')?.catch(()=>{}); openUrl(PLAN_PRO_URL); }}
                  onMax={()=>{ window.electronAPI?.convertTrial?.('max')?.catch(()=>{}); openUrl(PLAN_MAX_URL); }}
                  onUltra={()=>{ window.electronAPI?.convertTrial?.('ultra')?.catch(()=>{}); openUrl(PLAN_ULTRA_URL); }}
                  onStandard={()=>{
                    window.electronAPI?.convertTrial?.('standard')?.catch(()=>{});
                    if (onStandard) onStandard().catch(()=>{});
                    openUrl(PLAN_STANDARD_URL);
                  }}
                  onByok={handleByok}
                />
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
};

