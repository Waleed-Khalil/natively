#!/usr/bin/env node
//
// Quick health check on Gemini Flash Lite + Gemini Pro before a Phase 3
// test session. Hits both with a tiny prompt, reports response time and
// any errors. Skips the LLMHelper waterfall entirely so we see raw
// provider state, not the app's fallback logic.
//
// Usage: node scripts/provider-health-check.js

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const FLASH = 'gemini-3.1-flash-lite-preview';
const PRO = 'gemini-3.1-pro-preview';
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error('[provider-health-check] GEMINI_API_KEY not set in .env');
    process.exit(1);
}

async function probe(modelId) {
    const { GoogleGenAI } = require('@google/genai');
    const client = new GoogleGenAI({
        apiKey: API_KEY,
        httpOptions: { apiVersion: 'v1alpha' },
    });

    const startedAt = Date.now();
    try {
        const res = await client.models.generateContent({
            model: modelId,
            contents: 'Reply with exactly the word "ok".',
            config: { maxOutputTokens: 10, temperature: 0.0 },
        });
        const elapsed = Date.now() - startedAt;
        const text = (res.text || '').trim();
        return { ok: true, modelId, elapsedMs: elapsed, text };
    } catch (e) {
        const elapsed = Date.now() - startedAt;
        const status = e?.status ?? e?.response?.status ?? 'unknown';
        const message = e?.message ?? String(e);
        return { ok: false, modelId, elapsedMs: elapsed, status, message };
    }
}

async function main() {
    console.log(`[provider-health-check] Probing ${FLASH} and ${PRO}...\n`);
    const [flash, pro] = await Promise.all([probe(FLASH), probe(PRO)]);

    for (const r of [flash, pro]) {
        if (r.ok) {
            console.log(`✓ ${r.modelId}`);
            console.log(`    elapsed: ${r.elapsedMs}ms`);
            console.log(`    response: "${r.text}"`);
        } else {
            console.log(`✗ ${r.modelId}`);
            console.log(`    elapsed: ${r.elapsedMs}ms (failed)`);
            console.log(`    status: ${r.status}`);
            console.log(`    message: ${r.message.slice(0, 240)}`);
        }
        console.log('');
    }

    const allHealthy = flash.ok && pro.ok;
    if (allHealthy) {
        console.log('[provider-health-check] Both models healthy. Safe to run a Phase 3 test session.');
        process.exit(0);
    } else {
        console.log('[provider-health-check] At least one model failed. Wait before re-testing — perspective + answer calls will hit fallbacks and your data will be noisy.');
        process.exit(2);
    }
}

main().catch(err => {
    console.error('[provider-health-check] Unexpected error:', err);
    process.exit(1);
});
