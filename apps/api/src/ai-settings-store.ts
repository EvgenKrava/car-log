import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  AiModelSchema, AiProviderSchema, DEFAULT_AI_SETTINGS, type AiModel, type AiProvider,
} from '@carlog/contracts';

// The admin's saved AI choice. The Claude API key itself lives in SSM (AnthropicKeyStore);
// only its last four characters are kept here, for display.
export type StoredAiSettings = {
  provider: AiProvider;
  model: AiModel;
  keyHint: string | null;
  keySetAt: string | null;
  updatedAt: string | null;
};

export interface AiSettingsStore {
  get(): Promise<StoredAiSettings>;
  save(settings: StoredAiSettings): Promise<void>;
}

// What runs until an admin saves a choice.
export const INITIAL_AI_SETTINGS: StoredAiSettings = {
  ...DEFAULT_AI_SETTINGS, keyHint: null, keySetAt: null, updatedAt: null,
};

// One app-wide item in the single table. It sits outside every USER# partition, so
// per-user purges never touch it, and its SK matches neither scan filter (events,
// push subscriptions).
const KEY = { PK: 'APP#settings', SK: 'AI' };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export class DynamoAiSettingsStore implements AiSettingsStore {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async get(): Promise<StoredAiSettings> {
    const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: KEY, ConsistentRead: true }));
    const item = res.Item;
    if (!item) return INITIAL_AI_SETTINGS;
    // A stored value that no longer parses (a model since dropped from the list) falls
    // back to the default instead of breaking every AI call.
    const provider = AiProviderSchema.safeParse(item.provider);
    const model = AiModelSchema.safeParse(item.model);
    return {
      provider: provider.success ? provider.data : DEFAULT_AI_SETTINGS.provider,
      model: model.success ? model.data : DEFAULT_AI_SETTINGS.model,
      keyHint: str(item.keyHint),
      keySetAt: str(item.keySetAt),
      updatedAt: str(item.updatedAt),
    };
  }

  async save(settings: StoredAiSettings): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: { ...KEY, ...settings } }));
  }
}
