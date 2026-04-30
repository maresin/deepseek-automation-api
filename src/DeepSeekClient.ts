// src/DeepSeekClient.ts
import { BrowserManager } from './browser/BrowserManager.js';
import { AuthManager } from './auth/AuthManager.js';
import { ChatController } from './chat/ChatController.js';
import { ResponseExtractor } from './chat/ResponseExtractor.js';
import { FeatureToggles } from './features/FeatureToggles.js';
import { FileUploader } from './file/FileUploader.js';
import { ContextManager } from './context/ContextManager.js';
import { SessionRestorer } from './chat/SessionRestorer.js';
import { ActionQueue } from './actions/ActionQueue.js'; // может быть удалён позже, пока оставим
import { DeepSeekFeatures, DeepSeekResponse, SendMessageOptions } from './types.js';
import { Selectors } from './browser/Selectors.js';
import { TaskQueue } from './task/TaskQueue.js';
import { NewChatTask } from './tasks/NewChatTask.js';
import { RestoreChatTask } from './tasks/RestoreChatTask.js';
import { SendSystemPromptTask } from './tasks/SendSystemPromptTask.js';
import { SendUserMessageTask } from './tasks/SendUserMessageTask.js';

export class DeepSeekClient {
    public browserManager: BrowserManager;
    public authManager: AuthManager;
    public chatController: ChatController;
    public responseExtractor: ResponseExtractor;
    public featureToggles: FeatureToggles;
    public fileUploader: FileUploader;
    public contextManager: ContextManager;
    public actionQueue: ActionQueue; // для обратной совместимости, можно удалить позже
    public page: any;
    public config: any;
    public taskQueue: TaskQueue;

    private sessionRestorer: SessionRestorer;
    private isInitialized: boolean = false;
    private systemPromptSentFlag: boolean = false;
    private chatStarted: boolean = false;

    constructor(config: any = {}) {
        this.config = config;
        this.browserManager = new BrowserManager();
        this.authManager = new AuthManager(this.browserManager);
        this.chatController = new ChatController(this.browserManager);
        this.responseExtractor = new ResponseExtractor(this.browserManager);
        this.featureToggles = new FeatureToggles(this.browserManager, () => this.chatStarted);
        this.contextManager = new ContextManager(this);
        this.fileUploader = new FileUploader(this.chatController, this.contextManager);
        this.sessionRestorer = new SessionRestorer(this.browserManager);
        this.actionQueue = new ActionQueue(); // сохранён для совместимости, но будет вытеснен taskQueue
        this.taskQueue = new TaskQueue(this);
    }

    isSystemPromptSent(): boolean { return this.systemPromptSentFlag; }
    setSystemPromptSent(value: boolean = true): void { this.systemPromptSentFlag = value; }
    isChatStarted(): boolean { return this.chatStarted; }
    setChatStarted(value: boolean): void { this.chatStarted = value; }
    getSystemPromptText(): string | null { return this.config.systemPrompt || null; }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;
        const savedState = await this.loadState();
        const isAuthenticated = savedState && savedState.cookies && savedState.cookies.length > 0;
        await this.browserManager.launch(this.config.headless, this.config.viewport, savedState);
        if (isAuthenticated) {
            await this.browserManager.goto('https://chat.deepseek.com');
        } else {
            await this.browserManager.goto('https://chat.deepseek.com/sign_in');
        }
        await this.browserManager.page!.waitForTimeout(3000);
        await this.authManager.ensureAuthenticated(this.config.email, this.config.password);
        await this.saveState();
        this.page = this.browserManager.page;

        // Инициализация через очередь задач
        if (this.config.restoreSession) {
            await this.taskQueue.add(new RestoreChatTask());
        } else {
            await this.taskQueue.add(new NewChatTask());
        }
        // if (this.config.systemPrompt) {
        //     await this.taskQueue.add(new SendSystemPromptTask());
        // }

        this.isInitialized = true;
        console.log('✅ DeepSeek client ready!');
    }

    async newChat(options: { expertMode?: boolean; restore?: boolean; skipSystemPrompt?: boolean } = {}): Promise<void> {
        await this.chatController.newChat();
        this.chatStarted = false;
        this.systemPromptSentFlag = false;
        if (options.expertMode !== undefined) {
            await this.featureToggles.setExpertMode(options.expertMode);
        }
        if (options.restore) {
            await this.sessionRestorer.restoreLastChat();
            this.chatStarted = true;
            this.systemPromptSentFlag = true;
            console.log('Restored last chat');
        }
        if (!options.skipSystemPrompt && this.config.systemPrompt && !this.systemPromptSentFlag) {
            await this.executeSystemPrompt();
        }
        console.log('✅ New chat session created');
    }

    async getMaxMessageKey(): Promise<number> {
        const page = this.page!;
        try {
            await page.waitForSelector(Selectors.virtualListItem, { timeout: 5000 });
        } catch {
            return 0;
        }
        const elements = await page.$$(Selectors.virtualListItem);
        let max = 0;
        for (const el of elements) {
            const key = parseInt(await el.getAttribute('data-virtual-list-item-key') || '0', 10);
            if (key > max) max = key;
        }
        return max;
    }

    async waitForNewMessageKey(lastKey: number, timeoutMs: number = 300000): Promise<void> {
        await this.chatController.waitForAssistantMessage(lastKey, timeoutMs);
    }

    async executeSystemPrompt(): Promise<void> {
        const message = this.config.systemPrompt;
        if (!message) return;
        const lastKey = await this.getMaxMessageKey();
        await this.chatController.clearInput();
        await this.chatController.typeMessage(message);
        await this.chatController.send();
        await this.waitForNewMessageKey(lastKey);
        const newKey = await this.getMaxMessageKey();
        const response = await this.responseExtractor.getResponseByKeyWithCopy(newKey);
        if (response && response.toLowerCase().includes('ok')) {
            this.setSystemPromptSent(true);
            console.log('✅ System prompt confirmed');
        } else {
            console.warn('⚠️ System prompt response not OK:', response);
            this.setSystemPromptSent(true);
        }
    }

    /**
     * Pipeline for sending a message and receiving response (low-level browser actions)
     * Does NOT involve task queue – just direct browser automation
     */
    public async executePipeline(options: { text: string; filePath?: string }): Promise<string> {
        const { text, filePath } = options;
        const lastKey = await this.getMaxMessageKey();

        if (filePath) {
            await this.fileUploader.upload(filePath);
        }

        await this.chatController.clearInput();
        if (text) {
            await this.chatController.typeMessage(text);
        }
        await this.chatController.send();

        // Ждём завершения генерации ответа (метод отслеживает стрелку)
        await this.chatController.waitForResponseComplete();

        // Теперь ожидаем появления нового сообщения
        await this.waitForNewMessageKey(lastKey, 300000); // увеличенный таймаут
        const newKey = await this.getMaxMessageKey();
        const response = await this.responseExtractor.getResponseByKeyWithCopy(newKey);
        if (!response) {
            throw new Error('Failed to extract response from DeepSeek');
        }
        return response;
    }

    // Обёртка для совместимости: использует очередь задач
    async sendMessage(message: string, features: DeepSeekFeatures = {}, options: SendMessageOptions = {}): Promise<DeepSeekResponse> {
        const startTime = Date.now();
        const task = new SendUserMessageTask(message, options.filePath);   // удалён третий аргумент
        const content = await this.taskQueue.add(task);
        return {
            content,
            duration: Date.now() - startTime,
            featuresUsed: features,
            estimatedTokens: Math.ceil(message.length / 4)
        };
    }

    async saveState(): Promise<void> {
        const statePath = this.config.statePath || './state.json';
        await this.browserManager.saveState(statePath);
    }

    public async restoreLastChat(): Promise<boolean> {
        return await this.sessionRestorer.restoreLastChat();
    }

    private async loadState(): Promise<any> {
        const statePath = this.config.statePath || './state.json';
        return await this.browserManager.loadState(statePath);
    }

    async close(): Promise<void> {
        await this.browserManager.close();
    }
}

export default DeepSeekClient;