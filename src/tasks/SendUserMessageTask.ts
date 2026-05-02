import path from 'path';
import fs from 'fs';
import { Task } from '../task/Task.js';
import { DeepSeekClient } from '../DeepSeekClient.js';
import { NeedTransitionError } from '../file/FileUploader.js';

export class SendUserMessageTask extends Task<string> {
    constructor(
        private text: string,
        private filePath?: string
    ) {
        const desc = filePath ? `Send message with file ${filePath}` : `Send message: ${text.substring(0, 50)}`;
        super(desc, 'normal');
        this.maxRetries = 0;
    }

    private getFileSizeInChars(filePath: string): number {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return content.length;
        } catch {
            const stats = fs.statSync(filePath);
            return stats.size;
        }
    }

    async execute(client: DeepSeekClient): Promise<string> {
        if (client.needTransition) {
            console.log('🚦 Performing pending transition due to high context usage');
            await this.performTransition(client);
            client.needTransition = false;
        }

        if (!client.isSystemPromptSent() && client.getSystemPromptText()) {
            console.log('📌 Sending system prompt before user message...');
            const systemPromptText = client.getSystemPromptText()!;
            await client.executePipeline({ text: systemPromptText, skipStatsUpdate: true });
            client.setSystemPromptSent(true);
            console.log('✅ System prompt sent and confirmed');
        }

        let requiredChars = this.text.length;
        if (this.filePath) {
            requiredChars += this.getFileSizeInChars(this.filePath);
        }
        const canFit = await client.contextManager.canUploadFile(requiredChars);
        if (!canFit) {
            throw new NeedTransitionError(`Not enough context space for this message (need ${requiredChars} chars)`);
        }

        const response = await client.executePipeline({
            text: this.text,
            filePath: this.filePath,
            skipStatsUpdate: false
        });
        client.setChatStarted(true);
        return response;
    }

    private async performTransition(client: DeepSeekClient): Promise<void> {
        console.log('🔄 Starting transition to new chat due to context limit...');
        const snapshotPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_prompt.txt');
        if (!fs.existsSync(snapshotPromptPath)) {
            throw new Error('Snapshot prompt file not found');
        }
        const snapshotPrompt = fs.readFileSync(snapshotPromptPath, 'utf-8');
        console.log('📸 Creating context snapshot...');
        const wasDeepThink = await client.featureToggles.isDeepThinkEnabled();
        if (!wasDeepThink) await client.featureToggles.setDeepThink(true);
        const snapshotContent = await client.executePipeline({ text: snapshotPrompt, skipStatsUpdate: true });
        if (!wasDeepThink) await client.featureToggles.setDeepThink(false);
        if (!snapshotContent || snapshotContent.trim().length === 0) {
            throw new Error('Failed to create snapshot: empty response');
        }
        const snapshotFileName = `snapshot_${Date.now()}.txt`;
        const snapshotFilePath = path.join(process.cwd(), 'uploads', snapshotFileName);
        fs.writeFileSync(snapshotFilePath, snapshotContent, 'utf-8');
        console.log(`💾 Snapshot saved to file: ${snapshotFilePath}`);

        await client.chatController.newChat();
        client.setChatStarted(false);
        client.setSystemPromptSent(false);
        await client.contextManager.resetContext();

        const uploadPromptPath = path.join(process.cwd(), 'prompts', 'snapshot_upload_prompt.txt');
        let uploadPrompt = "Here is the context snapshot of our previous session (attached file). Please accept it and confirm by replying 'OK'.";
        if (fs.existsSync(uploadPromptPath)) {
            uploadPrompt = fs.readFileSync(uploadPromptPath, 'utf-8');
        }
        console.log('📤 Uploading snapshot file with prompt...');
        await client.executePipeline({ text: uploadPrompt, filePath: snapshotFilePath, skipStatsUpdate: true });

        try {
            fs.unlinkSync(snapshotFilePath);
            console.log(`🧹 Deleted snapshot file: ${snapshotFilePath}`);
        } catch (e) {}

        console.log('✅ Sync transition completed, retrying original request');
    }
}