/** Browser controller over the DSH ConfigForm live settings mirror. */
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client';
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { ReasoningDirtyFields, ReasoningModelDraft, ReasoningSettingsSnapshot } from './model-settings.js';
/** Minimal live form face shared by the three settings namespaces. */
export interface ReasoningConfigForm<T = unknown> {
    getSnapshot(): ConfigFormSnapshot<T>;
    subscribe(listener: () => void): () => void;
    mutate(ops: readonly SettingsPathOpView[], expectedRevision?: number): Promise<boolean>;
}
export interface ReasoningSettingsForms {
    piAi: ReasoningConfigForm;
    plugin: ReasoningConfigForm;
    agentDefault: ReasoningConfigForm;
}
/** Immutable controller view consumed through useSyncExternalStore. */
export interface ReasoningSettingsState {
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: string | null;
    saving: boolean;
    version: number;
    snapshot: ReasoningSettingsSnapshot | null;
}
/** One settings page controller; ConfigForm snapshots remain the fact source. */
export declare class ReasoningSettingsController {
    private readonly forms;
    private state;
    private readonly listeners;
    private readonly unsubscribeForms;
    private disposed;
    constructor(forms: ReasoningSettingsForms);
    readonly getSnapshot: () => ReasoningSettingsState;
    readonly subscribe: (listener: () => void) => (() => void);
    private publish;
    /** Re-derive the page snapshot from the three live forms. */
    private refresh;
    /** Refresh from the current form snapshots. */
    load(): Promise<boolean>;
    /** True once the page has loaded at least one Host snapshot. */
    loaded(): boolean;
    /** Save changed capabilities and defaults through their owning forms. */
    save(drafts: Readonly<Record<string, ReasoningModelDraft>>, dirty?: ReasoningDirtyFields): Promise<boolean>;
    /** Release form subscriptions when the owning page registration ends. */
    dispose(): void;
}
