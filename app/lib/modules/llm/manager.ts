

// lib/modules/llm/manager.ts
import { BaseProvider } from '@/lib/provider';
import { IProviderSetting, ModelInfo, ProviderInfo } from '@/lib/types/index';
import * as providers from './registry';

export class LLMManager {
  private static _instance: LLMManager;
  private _providers: Map<string, BaseProvider> = new Map();
  private _modelList: ModelInfo[] = [];
  private readonly _env: any = {};

  private constructor(_env: Record<string, string>) {
    this._registerProvidersFromDirectory();
    this._env = _env;
  }

  static getInstance(env: Record<string, string> = {}): LLMManager {
    if (!LLMManager._instance) {
      LLMManager._instance = new LLMManager(env);
    }

    return LLMManager._instance;
  }

  get env() {
    return this._env;
  }

  async getModelListFromProvider(
    providerArg: BaseProvider,
    options: {
      apiKeys?: Record<string, string>;
      providerSettings?: Record<string, IProviderSetting>;
      serverEnv?: Record<string, string>;
    }
  ): Promise<ModelInfo[]> {
    const provider = this._providers.get(providerArg.name);

    if (!provider) {
      throw new Error(`Provider ${providerArg.name} not found`);
    }

    const staticModels = provider.staticModels || [];

    if (!provider.getDynamicModels) {
      return staticModels;
    }
  }


  private _registerProvidersFromDirectory() {
    try {
      // Look for exported classes that extend BaseProvider
      for (const exportedItem of Object.values(providers)) {
        if (typeof exportedItem === 'function' && exportedItem.prototype instanceof BaseProvider) {
          const provider = new exportedItem();
          this.registerProvider(provider);
        }
      }
    } catch (error) {
      console.error('Error registering providers:', error);
    }
  }

  registerProvider(provider: BaseProvider) {
    if (this._providers.has(provider.name)) {
      console.warn(`Provider ${provider.name} is already registered. Skipping.`);
      return;
    }

    console.info('Registering Provider: ', provider.name);
    this._providers.set(provider.name, provider);
    this._modelList = [...this._modelList, ...provider.staticModels];
  }

  getProvider(name: string): BaseProvider | undefined {
    return this._providers.get(name);
  }

  getAllProviders(): BaseProvider[] {
    return Array.from(this._providers.values());
  }


  async updateModelList(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    serverEnv?: Record<string, string>;
  }): Promise<ModelInfo[]> {
    const { apiKeys, providerSettings, serverEnv } = options;

    let enabledProviders = Array.from(this._providers.values()).map(
      (p) => p.name
    );

    if (providerSettings && Object.keys(providerSettings).length > 0) {
      enabledProviders = enabledProviders.filter(
        (p) => providerSettings[p].enabled
      );
    }

    // Get dynamic models from all providers that support them
    const dynamicModels = await Promise.all(
      Array.from(this._providers.values())
        .filter((provider) => enabledProviders.includes(provider.name))
        .filter(
          (
            provider
          ): provider is BaseProvider &
          Required<Pick<ProviderInfo, "getDynamicModels">> =>
            !!provider.getDynamicModels
        )
        .map(async (provider) => {
          //   const cachedModels = provider.getModelsFromCache(options);

          //   if (cachedModels) {
          //     return cachedModels;
          //   }

          const dynamicModels = await provider
            .getDynamicModels(
              apiKeys,
              providerSettings?.[provider.name],
              serverEnv
            )
            .then((models) => {
              console.info(
                `Caching ${models.length} dynamic models for ${provider.name}`
              );
              //   provider.storeDynamicModels(options, models);

              return models;
            })
            .catch((err) => {
              console.error(
                `Error getting dynamic models ${provider.name} :`,
                err
              );
              return [];
            });

          return dynamicModels;
        })
    );
    const staticModels = Array.from(this._providers.values()).flatMap(
      (p) => p.staticModels || []
    );
    const dynamicModelsFlat = dynamicModels.flat();
    const dynamicModelKeys = dynamicModelsFlat.map(
      (d) => `${d.name}-${d.provider}`
    );
    const filteredStaticModesl = staticModels.filter(
      (m) => !dynamicModelKeys.includes(`${m.name}-${m.provider}`)
    );

    // Combine static and dynamic models
    const modelList = [...dynamicModelsFlat, ...filteredStaticModesl];
    modelList.sort((a, b) => a.name.localeCompare(b.name));
    this._modelList = modelList;

    return modelList;
  }

}
