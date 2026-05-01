import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import sharp from "sharp"
import { ModelVersionManager } from './services/ModelVersionManager'
import {
  HARD_SYSTEM_PROMPT, CLAUDE_SYSTEM_PROMPT,
  buildSystemPromptWithMeetingLayer
} from "./llm/prompts"
import { MeetingContextStore } from './services/MeetingContextStore'
import { createProviderRateLimiters } from './services/RateLimiter';

const CLAUDE_MODEL = "claude-sonnet-4-6"
const CLAUDE_HAIKU_MODEL = "claude-haiku-4-5-20251001"
const CLAUDE_MAX_OUTPUT_TOKENS = 64000

// Simple prompt for image analysis (not interview copilot - kept separate)
const IMAGE_ANALYSIS_PROMPT = `Analyze concisely. Be direct. No markdown formatting. Return plain text only.`

export class LLMHelper {
  private claudeClient: Anthropic | null = null
  private claudeApiKey: string | null = null
  private knowledgeOrchestrator: any = null;
  private customNotes: string = '';
  private aiResponseLanguage: string = 'auto';
  private sttLanguage: string = 'english-us';

  // Rate limiters per provider to prevent 429 errors on free tiers
  private rateLimiters: ReturnType<typeof createProviderRateLimiters>;

  // Self-improving model version manager
  private modelVersionManager: ModelVersionManager;

  private currentModelId: string = CLAUDE_MODEL;

  constructor(claudeApiKey?: string) {
    this.rateLimiters = createProviderRateLimiters();
    this.modelVersionManager = new ModelVersionManager();

    if (claudeApiKey) {
      this.claudeApiKey = claudeApiKey
      this.claudeClient = new Anthropic({ apiKey: claudeApiKey })
      console.log(`[LLMHelper] Claude client initialized with model: ${CLAUDE_MODEL}`)
    } else {
      console.warn("[LLMHelper] No Claude API key provided. Client will be uninitialized until key is set.")
    }
  }

  public setClaudeApiKey(apiKey: string) {
    this.claudeApiKey = apiKey;
    this.claudeClient = new Anthropic({ apiKey });
    console.log("[LLMHelper] Claude API Key updated.");
  }

  /**
   * Initialize the self-improving model version manager.
   * Should be called after the Claude API key is configured.
   */
  public async initModelVersionManager(): Promise<void> {
    this.modelVersionManager.setApiKeys({
      claude: this.claudeApiKey,
    });
    await this.modelVersionManager.initialize();
    console.log(this.modelVersionManager.getSummary());
  }

  /**
   * Scrub all API keys from memory to minimize exposure window.
   * Called on app quit.
   */
  public scrubKeys(): void {
    this.claudeApiKey = null;
    this.claudeClient = null;
    if (this.rateLimiters) {
      Object.values(this.rateLimiters).forEach(rl => rl.destroy());
    }
    this.modelVersionManager.stopScheduler();
    console.log('[LLMHelper] Keys scrubbed from memory');
  }

  public getAiResponseLanguage(): string {
    return this.aiResponseLanguage;
  }

  private isClaudeModel(modelId: string): boolean {
    return modelId.startsWith("claude-");
  }

  public setModel(modelId: string) {
    let targetModelId = modelId;
    if (modelId === 'claude') targetModelId = CLAUDE_MODEL;
    if (modelId === 'claude-haiku') targetModelId = CLAUDE_HAIKU_MODEL;

    if (!this.isClaudeModel(targetModelId)) {
      console.warn(`[LLMHelper] Unsupported model "${modelId}". Falling back to ${CLAUDE_MODEL}.`);
      targetModelId = CLAUDE_MODEL;
    }

    this.currentModelId = targetModelId;
    console.log(`[LLMHelper] Switched to Claude model: ${targetModelId}`);
  }

  private cleanJsonResponse(text: string): string {
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    text = text.trim();
    return text;
  }

  /**
   * Post-process the response — basic cleaning + filter out fallback phrases.
   */
  private processResponse(text: string): string {
    let clean = this.cleanJsonResponse(text);

    const fallbackPhrases = [
      "I'm not sure",
      "It depends",
      "I can't answer",
      "I don't know"
    ];

    if (fallbackPhrases.some(phrase => clean.toLowerCase().includes(phrase.toLowerCase()))) {
      throw new Error("Filtered fallback response");
    }

    return clean;
  }

  /**
   * Retry logic with exponential backoff. Handles 5xx and rate-limit errors.
   */
  private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let delay = 400;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (e: any) {
        const msg = e.message || '';
        const status = e.status ?? e.statusCode ?? 0;
        const isRetryable = msg.includes("503") || msg.includes("overloaded")
          || status === 529 || status === 429 || status === 500
          || msg.includes("rate_limit") || msg.includes("rate limit");

        if (!isRetryable) throw e;

        console.warn(`[LLMHelper] Transient error (${status || msg.slice(0, 40)}). Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw new Error("Model busy, try again");
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    promise.catch(() => {});

    return Promise.race([
      promise.then(result => {
        clearTimeout(timeoutHandle!);
        return result;
      }),
      timeoutPromise,
    ]);
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    const prompt = `You are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    const text = await this.generateWithClaude(prompt, IMAGE_ANALYSIS_PROMPT, imagePaths)
    return JSON.parse(this.cleanJsonResponse(text))
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `Given this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    const text = await this.generateWithClaude(prompt, IMAGE_ANALYSIS_PROMPT)
    return JSON.parse(this.cleanJsonResponse(text))
  }

  /**
   * Generate a structured 4-phase "Rolling Interview Script" from screenshot(s).
   */
  public async generateRollingScript(imagePaths: string[]): Promise<{
    problem_identifier_script: string;
    brainstorm_script: string;
    code: string;
    dry_run_script: string;
    time_complexity: string;
    space_complexity: string;
  }> {
    const systemPrompt = `You are an elite FAANG Senior Software Engineer taking a live technical interview.
The user has provided a screenshot of a coding problem. You must generate a highly structured "Rolling Interview Script" that the candidate can read out loud to pass the interview perfectly.

Output EXACTLY this JSON structure, and nothing else (no markdown fences around the whole response):
{
  "problem_identifier_script": "1-2 conversational sentences confirming you understand the problem and its edge cases. Start with 'So just to make sure I understand...'",
  "brainstorm_script": "3-4 conversational sentences. First, mention a naive/brute-force approach and its complexity. Then, pivot to the optimal approach, mentioning the key data structure or algorithm. End by asking the interviewer if you can proceed with the optimal approach. Keep it natural.",
  "code": "The full, production-ready, heavily-commented optimal code solution in the language shown or Python if unclear. Include all necessary imports.",
  "dry_run_script": "2-3 conversational sentences doing a quick dry-run of the code with a simple example input. E.g., 'Let\\'s trace this. If our array is [1,2], the loop starts...'",
  "time_complexity": "O(...) — brief 5-word explanation",
  "space_complexity": "O(...) — brief 5-word explanation"
}

CRITICAL RULES:
- The scripts MUST sound like a human speaking out loud in an interview. Use "I", "we", "my first thought is".
- The JSON must be perfectly valid. Escape any internal quotes with backslash.
- Do NOT wrap the JSON in markdown fences.`;

    const userPrompt = `Please analyze the coding problem shown in the screenshot(s) and generate the Rolling Interview Script JSON.`;

    const raw = await this.generateWithClaude(userPrompt, systemPrompt, imagePaths);
    const cleaned = this.cleanJsonResponse(raw);

    try {
      return JSON.parse(cleaned);
    } catch (_) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Could not extract valid JSON from LLM response');
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    const prompt = `You are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    const text = await this.generateWithClaude(prompt, IMAGE_ANALYSIS_PROMPT, debugImagePaths)
    return JSON.parse(this.cleanJsonResponse(text))
  }

  /**
   * Resize image to max 1536px and JPEG-encode at 80% to cut token usage.
   */
  private async processImage(path: string): Promise<{ mimeType: string, data: string }> {
    try {
      const imageBuffer = await fs.promises.readFile(path);
      const processedBuffer = await sharp(imageBuffer)
        .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      return { mimeType: "image/jpeg", data: processedBuffer.toString("base64") };
    } catch (error) {
      console.error("[LLMHelper] Failed to process image with sharp:", error);
      const data = await fs.promises.readFile(path);
      return { mimeType: "image/png", data: data.toString("base64") };
    }
  }

  public async analyzeImageFiles(imagePaths: string[]) {
    try {
      const prompt = `Describe the content of ${imagePaths.length > 1 ? 'these images' : 'this image'} in a short, concise answer. If it contains code or a problem, solve it.`;
      const text = await this.generateWithClaude(prompt, HARD_SYSTEM_PROMPT, imagePaths);
      return { text: text, timestamp: Date.now() };
    } catch (error: any) {
      console.error("Error analyzing image files:", error);
      return {
        text: `I couldn't analyze the screen right now (${error.message}). Please try again.`,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Generate a suggestion based on conversation transcript.
   */
  public async generateSuggestion(context: string, lastQuestion: string): Promise<string> {
    let activeModePrompt = '';
    let modeContextBlock = '';
    try {
      const { ModesManager } = require('./services/ModesManager');
      const modesMgr = ModesManager.getInstance();
      activeModePrompt = modesMgr.getActiveModeSystemPromptSuffix() ?? '';
      modeContextBlock = (await modesMgr.buildActiveModeContextBlock(lastQuestion)) ?? '';
    } catch (_modeErr: any) {
      console.warn('[LLMHelper] ModesManager load failed in generateSuggestion (non-fatal):', _modeErr?.message);
    }

    const enrichedContext = modeContextBlock
      ? `${modeContextBlock}\n\n${context}`
      : context;

    const customNotesBlock = this.customNotes?.trim()
      ? `\n\n<user_context>\n${this.customNotes.trim()}\n</user_context>\nUse this context naturally if relevant. Never quote it verbatim.`
      : '';

    const basePrompt = activeModePrompt
      ? `${HARD_SYSTEM_PROMPT}\n\n## ACTIVE MODE\n${activeModePrompt}${customNotesBlock}`
      : `You are an expert conversation coach. Based on the transcript, provide a concise, natural response the user could say.

RULES:
- Be direct and conversational
- Keep responses under 3 sentences unless complexity requires more
- Focus on answering the specific question asked
- If it's a technical question, provide a clear, structured answer
- Do NOT preface with "You could say" or similar - just give the answer directly
- If unsure, answer briefly and confidently anyway.
- Never hedge. Never say "it depends".${customNotesBlock}

CONVERSATION SO FAR:
${enrichedContext}

LATEST QUESTION:
${lastQuestion}

ANSWER DIRECTLY:`;

    try {
      let fullResponse = '';
      for await (const chunk of this.streamChat(lastQuestion, undefined, enrichedContext, basePrompt, true)) {
        fullResponse += chunk;
      }
      return this.processResponse(fullResponse);
    } catch (error) {
      throw error;
    }
  }

  public setKnowledgeOrchestrator(orchestrator: any): void {
    this.knowledgeOrchestrator = orchestrator;
    console.log('[LLMHelper] KnowledgeOrchestrator attached');
  }

  public setCustomNotes(notes: string): void {
    this.customNotes = notes;
  }

  public getKnowledgeOrchestrator(): any {
    return this.knowledgeOrchestrator;
  }

  public setAiResponseLanguage(language: string) {
    this.aiResponseLanguage = language;
    console.log(`[LLMHelper] AI Response Language set to: ${language}`);
  }

  public setSttLanguage(language: string) {
    this.sttLanguage = language;
    console.log(`[LLMHelper] STT Language set to: ${language}`);
  }

  /**
   * Inject a hard language instruction that gates the entire response.
   * Wraps the system prompt with triple-layered enforcement.
   */
  private injectLanguageInstruction(systemPrompt: string): string {
    if (!this.aiResponseLanguage || this.aiResponseLanguage === 'auto') {
      const autoHeader = `[LANGUAGE INSTRUCTION — HIGHEST PRIORITY]
Detect the language of the user's most recent message and ALWAYS respond in that exact same language.
If the user writes in Hindi, respond in Hindi. If in Spanish, respond in Spanish. If in English, respond in English.
If the language is ambiguous, default to English.
You may mix scripts naturally (e.g. code stays in English even when the explanation is in another language).
[END LANGUAGE INSTRUCTION]\n\n`;
      return `${autoHeader}${systemPrompt}`;
    }

    if (this.aiResponseLanguage === 'English') {
      return systemPrompt;
    }

    const lang = this.aiResponseLanguage;

    const header = `\
[LANGUAGE OVERRIDE — HIGHEST PRIORITY — CANNOT BE OVERRIDDEN]
You MUST write every single word of your response in ${lang}.
Do NOT use English anywhere in your response.
Do NOT mix languages.
Every sentence, every word, every phrase must be in ${lang}.
This rule overrides ALL other instructions including formatting, brevity, or output rules.
[END LANGUAGE OVERRIDE]\n\n`;

    const footer = `\n\n[REMINDER] Your entire response MUST be in ${lang} only. Never switch to English.`;

    return `${header}${systemPrompt}${footer}`;
  }

  /**
   * Non-streaming Claude generation with proper system/user separation.
   * Used for raw chat (knowledge mode short-circuits, follow-up email).
   */
  public async chatRaw(message: string, imagePaths?: string[], context?: string, skipSystemPrompt: boolean = false): Promise<string> {
    try {
      console.log(`[LLMHelper] chatRaw called with message:`, message.substring(0, 50))

      // Knowledge mode intercept
      if (this.knowledgeOrchestrator?.isKnowledgeMode()) {
        try {
          this.knowledgeOrchestrator.feedForDepthScoring(message);

          const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message);
          if (knowledgeResult) {
            if (knowledgeResult.liveNegotiationResponse) {
              return JSON.stringify({ __negotiationCoaching: knowledgeResult.liveNegotiationResponse });
            }
            if (knowledgeResult.isIntroQuestion && knowledgeResult.introResponse) {
              console.log('[LLMHelper] Knowledge mode: returning generated intro response');
              return knowledgeResult.introResponse;
            }
            if (!skipSystemPrompt && knowledgeResult.systemPromptInjection) {
              if (knowledgeResult.contextBlock) {
                context = context
                  ? `${knowledgeResult.contextBlock}\n\n${context}`
                  : knowledgeResult.contextBlock;
              }
            }
          }
        } catch (knowledgeError: any) {
          console.warn('[LLMHelper] Knowledge mode processing failed, falling back to normal:', knowledgeError.message);
        }
      }

      const userContent = context
        ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
        : message;

      const claudeSystemPrompt = skipSystemPrompt ? undefined : this.injectLanguageInstruction(CLAUDE_SYSTEM_PROMPT);

      if (!this.claudeClient) {
        throw new Error("Claude is the active model but no Anthropic API key is configured.");
      }
      const raw = await this.generateWithClaude(userContent, claudeSystemPrompt, imagePaths);
      return this.processResponse(raw);

    } catch (error: any) {
      console.error("[LLMHelper] Critical Error in chatRaw:", error);

      if (error.message.includes("503") || error.message.includes("overloaded")) {
        return "The AI service is currently overloaded. Please try again in a moment.";
      }
      if (error.message.includes("API key")) {
        return "Authentication failed. Please check your API key in settings.";
      }
      return `I encountered an error: ${error.message || "Unknown error"}. Please try again.`;
    }
  }

  /**
   * Generate content for structured JSON output tasks (resume/JD/company research).
   */
  public async generateContentStructured(message: string): Promise<string> {
    if (!this.claudeClient) {
      throw new Error(`Claude is the active model but no Anthropic API key is configured.`);
    }
    console.log(`[LLMHelper] 🧠 Structured generation: using Claude (${this.currentModelId})`);
    const result = await this.generateWithClaude(message);
    if (!result || result.trim().length === 0) {
      throw new Error(`Claude returned an empty response.`);
    }
    return result;
  }

  /**
   * Non-streaming Claude generation with proper system/user separation.
   */
  private async generateWithClaude(userMessage: string, systemPrompt?: string, imagePaths?: string[], modelId?: string): Promise<string> {
    if (!this.claudeClient) throw new Error("Claude client not initialized");

    await this.rateLimiters.claude.acquire();

    const model = modelId || (this.isClaudeModel(this.currentModelId) ? this.currentModelId : CLAUDE_MODEL);

    const content: any[] = [];
    if (imagePaths?.length) {
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const { mimeType, data } = await this.processImage(p);
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data,
            }
          });
        }
      }
    }
    content.push({ type: "text", text: userMessage });

    const collect = async (): Promise<string> => {
      const stream = await this.claudeClient!.messages.stream({
        model,
        max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: [{ role: "user", content }],
      });
      let text = "";
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text;
        }
      }
      return text;
    };

    return await this.withTimeout(
      this.withRetry(collect),
      90000,
      `Claude (${model})`
    );
  }

  /**
   * Universal Stream Chat — routes to Claude with all the meeting / mode /
   * knowledge context injection that the legacy multi-provider streamChat did.
   */
  public async * streamChat(
    message: string,
    imagePaths?: string[],
    context?: string,
    systemPromptOverride?: string,
    ignoreKnowledgeMode: boolean = false
  ): AsyncGenerator<string, void, unknown> {

    // Knowledge mode intercept (streaming)
    if (!ignoreKnowledgeMode && this.knowledgeOrchestrator?.isKnowledgeMode()) {
      try {
        this.knowledgeOrchestrator.feedForDepthScoring(message);

        const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message);
        if (knowledgeResult) {
          if (knowledgeResult.liveNegotiationResponse) {
            yield JSON.stringify({ __negotiationCoaching: knowledgeResult.liveNegotiationResponse });
            return;
          }
          if (knowledgeResult.isIntroQuestion && knowledgeResult.introResponse) {
            console.log('[LLMHelper] Knowledge mode (stream): returning generated intro response');
            yield knowledgeResult.introResponse;
            return;
          }
          if (knowledgeResult.systemPromptInjection) {
            systemPromptOverride = knowledgeResult.systemPromptInjection;
          }
          if (knowledgeResult.contextBlock) {
            context = context
              ? `${knowledgeResult.contextBlock}\n\n${context}`
              : knowledgeResult.contextBlock;
          }
        }
      } catch (knowledgeError: any) {
        console.warn('[LLMHelper] Knowledge mode (stream) processing failed, falling back:', knowledgeError.message);
      }
    }

    // Live meeting context injection
    let hasMeetingContext = false;
    try {
      const meetingStore = MeetingContextStore.getInstance();
      hasMeetingContext = meetingStore.hasContext();
      const meetingBlock = meetingStore.buildContextBlock();
      if (meetingBlock) {
        context = context ? `${meetingBlock}\n\n${context}` : meetingBlock;
      }
    } catch (_meetingErr: any) {
      console.warn('[LLMHelper] MeetingContextStore injection failed (non-fatal):', _meetingErr?.message);
    }

    // Active mode injection (context + system prompt suffix)
    try {
      const { ModesManager } = require('./services/ModesManager');
      const modesMgr = ModesManager.getInstance();
      const modePromptSuffix = modesMgr.getActiveModeSystemPromptSuffix();
      const modeContextBlock = await modesMgr.buildActiveModeContextBlock(message);

      const baseForMode = systemPromptOverride || HARD_SYSTEM_PROMPT;
      const baseWithMeeting = buildSystemPromptWithMeetingLayer(baseForMode, hasMeetingContext);

      if (modePromptSuffix) {
        systemPromptOverride = `${baseWithMeeting}\n\n## ACTIVE MODE\n${modePromptSuffix}`;
      } else if (hasMeetingContext) {
        systemPromptOverride = baseWithMeeting;
      }

      if (modeContextBlock) {
        const existingLen = context?.length ?? 0;
        const COMBINED_CTX_CAP = 60_000;
        if (existingLen + modeContextBlock.length > COMBINED_CTX_CAP) {
          const available = Math.max(0, COMBINED_CTX_CAP - existingLen);
          const trimmed = available > 0 ? modeContextBlock.slice(0, available) + '\n[...mode context truncated]' : '';
          console.warn(`[LLMHelper] Combined context exceeded ${COMBINED_CTX_CAP} chars — mode context trimmed`);
          if (trimmed) context = context ? `${trimmed}\n\n${context}` : trimmed;
        } else {
          context = context ? `${modeContextBlock}\n\n${context}` : modeContextBlock;
        }
      }
    } catch (_modeErr: any) {
      console.warn('[LLMHelper] ModesManager injection failed (non-fatal):', _modeErr?.message);
    }

    const baseSystemPrompt = systemPromptOverride || HARD_SYSTEM_PROMPT;
    const finalSystemPrompt = this.injectLanguageInstruction(baseSystemPrompt);

    const userContent = context
      ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
      : message;

    if (process.env.NATIVELY_LOG_PROMPT === '1') {
      const sysHash = require('crypto').createHash('sha1').update(finalSystemPrompt).digest('hex').slice(0, 8);
      console.log(
        `\n========== [LLMHelper.streamChat] PROMPT DUMP (sha1=${sysHash}, sys=${finalSystemPrompt.length} chars, user=${userContent.length} chars) ==========\n` +
        `--- SYSTEM PROMPT ---\n${finalSystemPrompt}\n` +
        `--- USER CONTENT ---\n${userContent}\n` +
        `========== END PROMPT DUMP ==========\n`
      );
    }

    if (!this.claudeClient) {
      throw new Error(`Claude is the active model but no Anthropic API key is configured.`);
    }

    const isMultimodal = !!(imagePaths?.length);
    if (isMultimodal && imagePaths) {
      yield* this.streamWithClaudeMultimodal(userContent, imagePaths, finalSystemPrompt);
    } else {
      yield* this.streamWithClaude(userContent, finalSystemPrompt);
    }
  }

  /**
   * Raw streaming chat — used by RAGManager and similar callers that already
   * have an assembled prompt and don't want active-mode/knowledge injection.
   * No meeting/mode/knowledge context is injected here.
   */
  public async * streamChatRaw(message: string, imagePaths?: string[], context?: string, skipSystemPrompt: boolean = false): AsyncGenerator<string, void, unknown> {
    console.log(`[LLMHelper] streamChatRaw called with message:`, message.substring(0, 50));

    const userContent = context
      ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
      : message;

    const claudeSystemPrompt = skipSystemPrompt ? undefined : this.injectLanguageInstruction(CLAUDE_SYSTEM_PROMPT);

    if (!this.claudeClient) {
      yield "No AI providers configured. Please add a Claude API key in Settings.";
      return;
    }

    const isMultimodal = !!(imagePaths?.length);
    try {
      if (isMultimodal && imagePaths) {
        yield* this.streamWithClaudeMultimodal(userContent, imagePaths, claudeSystemPrompt);
      } else {
        yield* this.streamWithClaude(userContent, claudeSystemPrompt);
      }
    } catch (err: any) {
      console.error(`[LLMHelper] ❌ streamChatRaw failed:`, err.message);
      yield `The AI service is currently unavailable: ${err.message}. Please try again.`;
    }
  }

  /**
   * Stream response from Claude with proper system/user message separation.
   */
  private async * streamWithClaude(userMessage: string, systemPrompt?: string, modelId?: string): AsyncGenerator<string, void, unknown> {
    if (!this.claudeClient) throw new Error("Claude client not initialized");

    const model = modelId || (this.isClaudeModel(this.currentModelId) ? this.currentModelId : CLAUDE_MODEL);

    const stream = await this.claudeClient.messages.stream({
      model,
      max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: userMessage }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  /**
   * Stream multimodal (image + text) response from Claude.
   */
  private async * streamWithClaudeMultimodal(userMessage: string, imagePaths: string[], systemPrompt?: string, modelId?: string): AsyncGenerator<string, void, unknown> {
    if (!this.claudeClient) throw new Error("Claude client not initialized");

    const model = modelId || (this.isClaudeModel(this.currentModelId) ? this.currentModelId : CLAUDE_MODEL);

    const imageContentParts: any[] = [];
    for (const p of imagePaths) {
      if (fs.existsSync(p)) {
        const { mimeType, data } = await this.processImage(p);
        imageContentParts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType,
            data,
          }
        });
      }
    }

    const stream = await this.claudeClient.messages.stream({
      model,
      max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{
        role: "user",
        content: [
          ...imageContentParts,
          { type: "text", text: userMessage }
        ]
      }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  public getCurrentProvider(): "claude" {
    return "claude";
  }

  public getCurrentModel(): string {
    return this.currentModelId;
  }

  public getPromptProvider(): import('./llm/prompts/types').Provider {
    return 'claude';
  }

  public getPromptFraming(): import('./llm/prompts/types').Framing {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const { framingFromTemplate } = require('./llm/prompts');
      const mode = ModesManager.getInstance().getActiveMode();
      return framingFromTemplate(mode?.templateType ?? null);
    } catch {
      return 'interview';
    }
  }

  public getPromptContext(): import('./llm/prompts/types').PromptContext {
    return {
      provider: this.getPromptProvider(),
      framing: this.getPromptFraming(),
    };
  }

  public getClaudeClient(): Anthropic | null {
    return this.claudeClient;
  }

  public hasClaude(): boolean {
    return this.claudeClient !== null;
  }

  /**
   * Robust Meeting Summary Generation — Claude only.
   */
  public async generateMeetingSummary(systemPrompt: string, context: string): Promise<string> {
    console.log(`[LLMHelper] generateMeetingSummary called. Context length: ${context.length}`);

    if (!this.claudeClient) {
      throw new Error(`Claude is the active model but no Anthropic API key is configured.`);
    }

    const model = this.currentModelId;
    console.log(`[LLMHelper] Generating meeting summary with Claude (${model})`);
    const text = await this.withTimeout(
      this.generateWithClaude(`Context:\n${context}`, systemPrompt, undefined, model),
      90000,
      `Claude Summary (${model})`
    );
    if (text.trim().length === 0) {
      throw new Error(`Claude (${model}) returned an empty summary.`);
    }
    console.log(`[LLMHelper] ✅ Claude summary generated successfully.`);
    return this.processResponse(text);
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.claudeClient) {
        return { success: false, error: "No Claude client configured" };
      }
      const text = await this.generateWithClaude("Hello", undefined);
      if (text) {
        return { success: true };
      }
      return { success: false, error: "Empty response from Claude" };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Universal Chat (Non-streaming).
   */
  public async chat(message: string, imagePaths?: string[], context?: string, systemPromptOverride?: string): Promise<string> {
    let fullResponse = "";
    for await (const chunk of this.streamChat(message, imagePaths, context, systemPromptOverride)) {
      fullResponse += chunk;
    }
    return fullResponse;
  }
}
