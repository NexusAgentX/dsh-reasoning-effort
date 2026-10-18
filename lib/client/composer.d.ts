/** Session-scoped Composer model selector with a continuous reasoning-effort slider. */
import type { ModelProviderGroup, ModelReasoningEffort } from '@deepseek-ai/dsh-api-remotes/client';
import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { ReasoningSettingsController, ReasoningSettingsState } from './controller.js';
import type { ReasoningSettingsLocaleKey } from './locales.js';
type Translate = (key: ReasoningSettingsLocaleKey, params?: Record<string, unknown>) => string;
export interface ComposerModelSelectInjected {
    available: boolean;
    directory: ModelDirectory;
    settings: ReasoningSettingsController;
    t: Translate;
}
export type ComposerModelSelectProps = ComposerModelSelectInjected & {
    locked: boolean;
};
type DirectoryModel = ModelProviderGroup['models'][number];
export declare function currentModel(state: ModelDirectoryState): DirectoryModel | undefined;
export declare function sliderLevels(state: ModelDirectoryState): readonly ModelReasoningEffort[];
export declare function effortIndex(levels: readonly ModelReasoningEffort[], id: string | undefined): number;
/** Index displayed by Composer, matching the request-time precedence. */
export declare function effectiveEffortIndex(levels: readonly ModelReasoningEffort[], directory: ModelDirectoryState, settings: ReasoningSettingsState): number;
export declare function effortIntervalIndex(position: number, count: number): number;
export interface CommittedEffort {
    index: number;
    id: string;
}
/** Revalidate against the fresh directory, then write only the session selection. */
export declare function commitDirectoryEffort(directory: ModelDirectory, raw: number, noEffortsMessage: string): Promise<CommittedEffort>;
export declare function ComposerModelSelect(props: ComposerModelSelectProps): import("react").JSX.Element | null;
export {};
