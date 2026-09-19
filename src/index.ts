// src/index.ts
/**
 * @file src/index.ts
 * Main exports for the DeepSeek Automation API.
 */

export { DeepSeekClient } from './DeepSeekClient.js';
export { default } from './DeepSeekClient.js';
export * from './types.js';

// Core
export { Task } from './task/Task.js';
export { TaskQueue } from './task/TaskQueue.js';

// Toggles
export { SwitchDeepThinkTask } from './tasks/SwitchDeepThinkTask.js';
export { SwitchWebSearchTask } from './tasks/SwitchWebSearchTask.js';

// Chat operations
export { SendUserMessageTask } from './tasks/SendUserMessageTask.js';