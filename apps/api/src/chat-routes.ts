import { ChatRequestSchema } from '@carlog/contracts';
import {
  CarNotFoundError, chatAboutCar, buildCarChatContext,
  type CarRepository, type EventRepository, type ReminderRepository, type LlmProvider,
} from '@carlog/domain';
import type { Car } from '@carlog/contracts';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';

export type ChatDeps = {
  cars: CarRepository;
  events: EventRepository;
  reminders: ReminderRepository;
  llm: LlmProvider;
};

// Handles POST /cars/{carId}/chat ; returns null if not matched.
export async function handleChatRoute(
  deps: ChatDeps, event: ApiEvent, ownerId: string, carId: string,
): Promise<ApiResult | null> {
  const { method, path, body } = event;
  if (path !== `/cars/${carId}/chat` || method !== 'POST') return null;

  const car: Car | null = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);

  const { messages } = ChatRequestSchema.parse(body);
  const [events, reminders] = await Promise.all([
    deps.events.listByCar(ownerId, carId),
    deps.reminders.listByCar(ownerId, carId),
  ]);
  const context = buildCarChatContext(car, events, reminders);
  const reply = await chatAboutCar(messages, deps.llm, context);
  return ok(200, { reply });
}