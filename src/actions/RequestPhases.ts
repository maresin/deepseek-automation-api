// src/actions/RequestPhases.ts
import { DeepSeekClient } from '../DeepSeekClient.js';
import { DeepSeekFeatures, SendMessageOptions } from '../types.js';

export interface RequestContext {
    client: DeepSeekClient;
    message: string;
    features: DeepSeekFeatures;
    options: SendMessageOptions;
    filePath?: string;
    lastKey?: number;
    responseContent?: string;
}

export type RequestPhase = (ctx: RequestContext) => Promise<void>;

export const applyFeaturesPhase: RequestPhase = async (ctx) => {
    if (ctx.features.deepThink !== undefined) await ctx.client.featureToggles.setDeepThink(ctx.features.deepThink);
    if (ctx.features.webSearch !== undefined) await ctx.client.featureToggles.setWebSearch(ctx.features.webSearch);
    if (ctx.features.expertMode !== undefined) await ctx.client.featureToggles.setExpertMode(ctx.features.expertMode);
};

export const uploadFilePhase: RequestPhase = async (ctx) => {
    if (ctx.options.filePath && !ctx.options.skipFileUpload) {
        await ctx.client.fileUploader.upload(ctx.options.filePath);
        ctx.filePath = ctx.options.filePath;
    }
};

export const ensureSystemPromptPhase: RequestPhase = async (ctx) => {
    if (!ctx.client.isSystemPromptSent() && ctx.client.config.systemPrompt) {
        await ctx.client.executeSystemPrompt();
    }
};

export const sendMessagePhase: RequestPhase = async (ctx) => {
    ctx.lastKey = await ctx.client.getMaxMessageKey();
    console.log(`📌 sendMessagePhase: lastKey = ${ctx.lastKey}`);
    await ctx.client.chatController.clearInput();
    if (ctx.filePath) {
        await ctx.client.chatController.attachFile(ctx.filePath);
    }
    await ctx.client.chatController.typeMessage(ctx.message);
    await ctx.client.chatController.send();
};

export const waitForResponsePhase: RequestPhase = async (ctx) => {
    if (ctx.lastKey === undefined) throw new Error('lastKey not set');
    await ctx.client.waitForNewMessageKey(ctx.lastKey);
};

export const extractResponsePhase: RequestPhase = async (ctx) => {
    const newKey = await ctx.client.getMaxMessageKey();
    ctx.responseContent = await ctx.client.responseExtractor.getResponseByKeyWithCopy(newKey);
    if (!ctx.responseContent) {
        ctx.responseContent = await ctx.client.responseExtractor.getResponseViaCopyButton();
    }
    if (!ctx.responseContent) {
        ctx.responseContent = await ctx.client.responseExtractor.getResponseViaMarkdown();
    }
};