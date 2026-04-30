import { DeepSeekClient } from '../DeepSeekClient.js';
export declare function createSnapshotIfNeeded(client: DeepSeekClient): Promise<boolean>;
export declare function recoverFromAutoReset(client: DeepSeekClient): Promise<void>;
export declare function selfTransitionViaButton(client: DeepSeekClient): Promise<void>;
