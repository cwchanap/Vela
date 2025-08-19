import { config } from '../../config';
import type { LLMProvider, LLMProviderName, LLMRequest, LLMResponse } from './types';
import { GoogleProvider } from './providers/googleProvider';
import { OpenRouterProvider } from './providers/openrouterProvider';

export class LLMService {
  private provider: LLMProvider;
  private providers: Partial<Record<LLMProviderName, LLMProvider>> = {};

  constructor() {
    // Initialize with safe internal defaults; store will override based on user profile
    const defaultName: LLMProviderName = 'google';
    this.provider = this.initProvider(defaultName);
  }

  private initProvider(name: LLMProviderName, model?: string): LLMProvider {
    const existing = this.providers[name];
    if (existing) return existing;

    let instance: LLMProvider;
    if (name === 'google') {
      const opts: { model?: string } = {};
      if (model) opts.model = model;
      instance = new GoogleProvider(opts);
    } else if (name === 'openrouter') {
      const opts: { model?: string; appName?: string } = {
        appName: config.app.name,
      };
      if (model) opts.model = model;
      instance = new OpenRouterProvider(opts);
    } else {
      // Fallback to google
      const opts: { model?: string } = {};
      if (model) opts.model = model;
      instance = new GoogleProvider(opts);
    }

    // Ensure default model is set if provided
    if (model) instance.setModel(model);

    this.providers[name] = instance;
    return instance;
  }

  getProviderName(): LLMProviderName {
    return this.provider.name;
  }

  setProvider(name: LLMProviderName, model?: string) {
    this.provider = this.initProvider(name, model);
  }

  setModel(model: string) {
    this.provider.setModel(model);
  }

  getModel(): string {
    return this.provider.getModel();
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    return this.provider.generate(request);
  }
}

export const llmService = new LLMService();
export * from './types';
