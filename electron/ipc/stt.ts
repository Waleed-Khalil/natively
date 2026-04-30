import { BrowserWindow } from "electron";
import { AppState } from "../main";
import { safeHandle, sanitizeErrorMessage } from "./helpers";

export function registerSttHandlers(appState: AppState): void {
  safeHandle("set-stt-provider", async (_, provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively') => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setSttProvider(provider);

      // Reconfigure the audio pipeline to use the new STT provider
      await appState.reconfigureSttProvider();

      // Notify all windows so the settings UI reflects the change immediately
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });

      return { success: true };
    } catch (error: any) {
      console.error("Error setting STT provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("get-stt-provider", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      return CredentialsManager.getInstance().getSttProvider();
    } catch (error: any) {
      return 'none';
    }
  });

  safeHandle("set-groq-stt-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttApiKey(apiKey);
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Groq STT API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-openai-stt-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setOpenAiSttApiKey(apiKey);
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
      return { success: true };
    } catch (error: any) {
      console.error("Error saving OpenAI STT API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-deepgram-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setDeepgramApiKey(apiKey);
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Deepgram API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-groq-stt-model", async (_, model: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttModel(model);

      // Reconfigure the audio pipeline to use the new model
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting Groq STT model:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-elevenlabs-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setElevenLabsApiKey(apiKey);
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
      return { success: true };
    } catch (error: any) {
      console.error("Error saving ElevenLabs API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-azure-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setAzureApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Azure API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-azure-region", async (_, region: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setAzureRegion(region);

      // Reconfigure the pipeline since region changes the endpoint URL
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting Azure region:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-ibmwatson-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setIbmWatsonApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving IBM Watson API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-soniox-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setSonioxApiKey(apiKey);
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Soniox API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-ibmwatson-region", async (_, region: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setIbmWatsonRegion(region);

      // Reconfigure the pipeline since region changes the endpoint URL
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting IBM Watson region:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("test-stt-connection", async (_, provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', apiKey: string, region?: string) => {
    console.log(`[IPC] Received test - stt - connection request for provider: ${provider} `);
    try {
      if (provider === 'deepgram') {
        const WebSocket = require('ws');
        const token = apiKey.trim();
        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          const url = 'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1';
          const ws = new WebSocket(url, {
            headers: { Authorization: `Token ${token}` },
          });

          const timeout = setTimeout(() => {
            ws.close();
            console.error('[IPC] Deepgram test failed: Connection timed out');
            resolve({ success: false, error: 'Connection timed out' });
          }, 15000);

          ws.on('open', () => {
            clearTimeout(timeout);
            try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch { }
            ws.close();
            resolve({ success: true });
          });

          ws.on('unexpected-response', (request: any, response: any) => {
            clearTimeout(timeout);
            const status = response.statusCode;
            let body = '';
            response.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            response.on('end', () => {
              const errMsg = `Unexpected server response: ${status} - ${body}`;
              console.error(`[IPC] Deepgram test failed: ${errMsg}`);
              resolve({ success: false, error: errMsg });
            });
          });

          ws.on('error', (err: any) => {
            clearTimeout(timeout);
            console.error(`[IPC] Deepgram test error: ${err.message}`);
            resolve({ success: false, error: err.message || 'Connection failed' });
          });
        });
      }

      if (provider === 'soniox') {
        // Test Soniox via WebSocket connection.
        // With a valid key, Soniox accepts the config and then silently waits for audio —
        // it never sends a response message. With an invalid key it immediately sends an
        // error message and closes. So the strategy is:
        //   • If we receive an error message → fail
        //   • If the connection errors at the WS level → fail
        //   • If 2.5 s pass after sending the config with no error → success
        const WebSocket = require('ws');
        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          let resolved = false;
          const done = (result: { success: boolean; error?: string }) => {
            if (resolved) return;
            resolved = true;
            try { ws.close(); } catch { }
            resolve(result);
          };

          const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

          // Hard connect timeout — server unreachable
          const connectTimeout = setTimeout(() => {
            done({ success: false, error: 'Connection timed out' });
          }, 10000);

          ws.on('open', () => {
            clearTimeout(connectTimeout);
            ws.send(JSON.stringify({
              api_key: apiKey,
              model: 'stt-rt-v4',
              audio_format: 'pcm_s16le',
              sample_rate: 16000,
              num_channels: 1,
            }));
            // Give Soniox 2.5 s to reject the key; silence means the key is valid
            setTimeout(() => done({ success: true }), 2500);
          });

          ws.on('message', (msg: any) => {
            try {
              const res = JSON.parse(msg.toString());
              if (res.error_code) {
                done({ success: false, error: `${res.error_code}: ${res.error_message}` });
              }
              // Non-error message is unexpected but treat as success
            } catch {
              // Unparseable message — treat as success
            }
          });

          ws.on('error', (err: any) => {
            clearTimeout(connectTimeout);
            done({ success: false, error: err.message || 'Connection failed' });
          });

          ws.on('close', (code: number) => {
            // Abnormal close before we resolved means the server rejected us
            if (!resolved && code !== 1000) {
              done({ success: false, error: `Server closed connection (code ${code})` });
            }
          });
        });
      }

      const axios = require('axios');
      const FormData = require('form-data');

      // Generate a tiny silent WAV (0.5s of silence at 16kHz mono 16-bit)
      const numSamples = 8000;
      const pcmData = Buffer.alloc(numSamples * 2);
      const wavHeader = Buffer.alloc(44);
      wavHeader.write('RIFF', 0);
      wavHeader.writeUInt32LE(36 + pcmData.length, 4);
      wavHeader.write('WAVE', 8);
      wavHeader.write('fmt ', 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20);
      wavHeader.writeUInt16LE(1, 22);
      wavHeader.writeUInt32LE(16000, 24);
      wavHeader.writeUInt32LE(32000, 28);
      wavHeader.writeUInt16LE(2, 32);
      wavHeader.writeUInt16LE(16, 34);
      wavHeader.write('data', 36);
      wavHeader.writeUInt32LE(pcmData.length, 40);
      const testWav = Buffer.concat([wavHeader, pcmData]);

      if (provider === 'elevenlabs') {
        // ElevenLabs: Use /v1/voices to validate the API key (minimal scope required).
        // Scoped keys may lack speech_to_text or user_read but still be usable once permissions are added.
        try {
          await axios.get('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': apiKey },
            timeout: 10000,
          });
        } catch (elErr: any) {
          const elStatus = elErr?.response?.data?.detail?.status;
          // If the error is "invalid_api_key", the key itself is wrong — fail.
          // Any other error (missing permission, etc.) means the key IS valid, just possibly scoped.
          if (elStatus === 'invalid_api_key') {
            throw elErr;
          }
          // Key is valid but scoped — pass with a warning
          console.log('[IPC] ElevenLabs key is valid but may have restricted scopes. Saving key.');
        }
      } else if (provider === 'azure') {
        // Azure: raw binary with subscription key
        const azureRegion = region || 'eastus';
        await axios.post(
          `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`,
          testWav,
          {
            headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'Content-Type': 'audio/wav' },
            timeout: 15000,
          }
        );
      } else if (provider === 'ibmwatson') {
        // IBM Watson: raw binary with Basic auth
        const ibmRegion = region || 'us-south';
        await axios.post(
          `https://api.${ibmRegion}.speech-to-text.watson.cloud.ibm.com/v1/recognize`,
          testWav,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}`,
              'Content-Type': 'audio/wav',
            },
            timeout: 15000,
          }
        );
      } else {
        // Groq / OpenAI: multipart FormData
        const endpoint = provider === 'groq'
          ? 'https://api.groq.com/openai/v1/audio/transcriptions'
          : 'https://api.openai.com/v1/audio/transcriptions';
        const model = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';

        const form = new FormData();
        form.append('file', testWav, { filename: 'test.wav', contentType: 'audio/wav' });
        form.append('model', model);

        await axios.post(endpoint, form, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...form.getHeaders(),
          },
          timeout: 15000,
        });
      }

      return { success: true };
    } catch (error: any) {
      const respData = error?.response?.data;
      const rawMsg = respData?.error?.message || respData?.detail?.message || respData?.message || error.message || 'Connection failed';
      const msg = sanitizeErrorMessage(rawMsg);
      console.error("STT connection test failed:", msg);
      return { success: false, error: msg };
    }
  });
}
