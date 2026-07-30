import type { AiProvider } from '../../application/ports/ai-provider';
import type { AiServiceEnv } from '../../config/env';
import { LocalHeuristicProvider } from './local.provider';

/**
 * Selects the model provider for this process.
 *
 * This function is the extension point for connecting a paid provider
 * (ADR 0010). Adding one is:
 *
 *   1. add its id to AI_PROVIDERS in src/config/env.ts, with its
 *      credentials required only when it is the selected provider;
 *   2. write src/infrastructure/providers/<id>.provider.ts implementing
 *      AiProvider;
 *   3. add its case below;
 *   4. assert it with checkAiProviderContract (provider-contract.ts).
 *
 * Nothing in the domain, application layer, controller, BFF or UI changes.
 * The `never` assignment keeps that honest: a new value in AI_PROVIDERS
 * fails to compile until this switch handles it.
 */
export function createAiProvider(env: AiServiceEnv): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'local':
      return new LocalHeuristicProvider();
    default: {
      const unsupported: never = env.AI_PROVIDER;
      throw new Error(`unsupported AI_PROVIDER: ${String(unsupported)}`);
    }
  }
}
