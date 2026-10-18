/** Plugin-provided settings section for exact-route reasoning capabilities and defaults. */
import type { ReactNode } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import { ReasoningSettingsController } from './controller.js';
import type { ReasoningSettingsLocaleKey } from './locales.js';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Exact-route reasoning capabilities and defaults. */
        'settings.providers-reasoning': ReasoningSettingsLocaleKey;
    }
}
/** Services required by the browser half. */
export declare const inject: string[];
export interface ReasoningSettingsInjected {
    controller: ReasoningSettingsController;
    t: (key: ReasoningSettingsLocaleKey, params?: Record<string, unknown>) => string;
}
export type ReasoningSettingsSectionProps = Partial<ReasoningSettingsInjected>;
/** Slot component wrapper; the renderer may mount before injection settles. */
export declare function ReasoningSettingsSection(props: ReasoningSettingsSectionProps): ReactNode;
/** Register the live ConfigForm-backed settings page and composer control. */
export declare function apply(ctx: Context): void;
