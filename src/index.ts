// src/index.ts
export { DeepSeekClient } from './DeepSeekClient.js';
export { default } from './DeepSeekClient.js';
export * from './types.js';

export { Task } from './task/Task.js';
export { TaskQueue } from './task/TaskQueue.js';

export { SwitchExpertModeTask } from './tasks/SwitchExpertModeTask.js';
export { SwitchDeepThinkTask } from './tasks/SwitchDeepThinkTask.js';
export { SwitchWebSearchTask } from './tasks/SwitchWebSearchTask.js';
export { NewChatTask } from './tasks/NewChatTask.js';
export { RestoreChatTask } from './tasks/RestoreChatTask.js';
export { SendSystemPromptTask } from './tasks/SendSystemPromptTask.js';
export { SendUserMessageTask } from './tasks/SendUserMessageTask.js';