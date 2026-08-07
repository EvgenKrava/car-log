import { z } from 'zod';
import {
  CarSchema,
  type Car,
  type CreateCarInput,
  EventSchema,
  type Event,
  type CreateEventInput,
  ProofWithUrlSchema,
  ProofSchema,
  ProofPresignResponseSchema,
  type ProofWithUrl,
  type ProofPresignResponse,
  type AttachmentContentType,
  ExtractEventsResponseSchema,
  type ExtractEventsResponse,
  ImportJobSchema,
  type ImportJob,
  ReminderSchema,
  type Reminder,
  type CreateReminderInput,
  type CompleteReminderInput,
  AdminUserSchema,
  ListUsersResponseSchema,
  type ListUsersResponse,
  MetricsResponseSchema,
  type MetricsResponse,
  PublicCarSchema,
  type PublicCar,
  ChatSessionSchema,
  ChatSessionSummarySchema,
  PostMessageResponseSchema,
  ChatAttachmentPresignResponseSchema,
  TranscribeResponseSchema,
  type ChatSession,
  type ChatSessionSummary,
  type PostMessageResponse,
  type AttachmentRef,
  type ScanDocContentType,
  type CarExport,
} from '@carlog/contracts';

const CarListSchema = z.array(CarSchema);
const EventListSchema = z.array(EventSchema);
const ProofListSchema = z.array(ProofWithUrlSchema);
const API_URL = import.meta.env.VITE_API_URL as string;

// Bind the generic to the schema's OUTPUT type (post-parse). Schemas that use
// `.default()` (e.g. Event.currency/works) have a looser INPUT type where those
// fields are optional; `.parse()` returns the output where they are present, so
// callers get the correct required-field types.
async function request<S extends z.ZodTypeAny>(
  token: string, path: string, schema: S, init?: RequestInit,
): Promise<z.output<S>> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return undefined as z.output<S>;
  return schema.parse(await res.json()) as z.output<S>;
}

export const listCars = (token: string): Promise<Car[]> => request(token, '/cars', CarListSchema);
export const createCar = (token: string, input: CreateCarInput): Promise<Car> =>
  request(token, '/cars', CarSchema, { method: 'POST', body: JSON.stringify(input) });

export const getCar = (token: string, id: string): Promise<Car> =>
  request(token, `/cars/${id}`, CarSchema);

export const updateCar = (token: string, id: string, input: CreateCarInput): Promise<Car> =>
  request(token, `/cars/${id}`, CarSchema, { method: 'PUT', body: JSON.stringify(input) });

export const deleteCar = (token: string, id: string): Promise<void> =>
  request(token, `/cars/${id}`, CarSchema, { method: 'DELETE' }).then(() => undefined);

export const setCarSharing = (token: string, carId: string, shared: boolean): Promise<Car> =>
  request(token, `/cars/${carId}/sharing`, CarSchema, { method: 'PUT', body: JSON.stringify({ shared }) });

export async function getPublicCar(carId: string): Promise<PublicCar> {
  const res = await fetch(`${API_URL}/public/cars/${encodeURIComponent(carId)}`);
  if (res.status === 404) throw new Error('NOT_SHARED');
  if (!res.ok) throw new Error(`API ${res.status}`);
  return PublicCarSchema.parse(await res.json());
}

export async function uploadToS3(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!res.ok) throw new Error(`S3 upload ${res.status}`);
}

export const getEvents = (token: string, carId: string): Promise<Event[]> =>
  request(token, `/cars/${carId}/events`, EventListSchema);
export const createEvent = (token: string, carId: string, input: CreateEventInput): Promise<Event> =>
  request(token, `/cars/${carId}/events`, EventSchema, { method: 'POST', body: JSON.stringify(input) });
export const updateEvent = (token: string, carId: string, eventId: string, input: CreateEventInput): Promise<Event> =>
  request(token, `/cars/${carId}/events/${eventId}`, EventSchema, { method: 'PUT', body: JSON.stringify(input) });
export const deleteEvent = (token: string, carId: string, eventId: string): Promise<void> =>
  request(token, `/cars/${carId}/events/${eventId}`, EventSchema, { method: 'DELETE' }).then(() => undefined);

const proofBase = (carId: string, eventId: string) => `/cars/${carId}/events/${eventId}/proofs`;
export const presignProof = (token: string, carId: string, eventId: string, input: { contentType: AttachmentContentType; size: number; filename?: string }): Promise<ProofPresignResponse> =>
  request(token, `${proofBase(carId, eventId)}/presign`, ProofPresignResponseSchema, { method: 'POST', body: JSON.stringify(input) });
export const confirmProof = (token: string, carId: string, eventId: string, input: { proofId: string; contentType: AttachmentContentType; size: number; filename?: string }) =>
  request(token, proofBase(carId, eventId), ProofSchema, { method: 'POST', body: JSON.stringify(input) });
export const listProofs = (token: string, carId: string, eventId: string): Promise<ProofWithUrl[]> =>
  request(token, proofBase(carId, eventId), ProofListSchema);
export const deleteProof = (token: string, carId: string, eventId: string, proofId: string): Promise<void> =>
  request(token, `${proofBase(carId, eventId)}/${proofId}`, ProofSchema, { method: 'DELETE' }).then(() => undefined);

export async function uploadProof(token: string, carId: string, eventId: string, file: File): Promise<void> {
  const input = { contentType: file.type as AttachmentContentType, size: file.size, filename: file.name };
  const { uploadUrl, proofId } = await presignProof(token, carId, eventId, input);
  await uploadToS3(uploadUrl, file);
  await confirmProof(token, carId, eventId, { ...input, proofId });
}

export const importCar = (token: string, file: CarExport): Promise<Car> =>
  request(token, '/import/car', CarSchema, { method: 'POST', body: JSON.stringify(file) });

export const extractEvents = (token: string, carId: string, text: string): Promise<ExtractEventsResponse> =>
  request(token, '/import/extract', ExtractEventsResponseSchema, { method: 'POST', body: JSON.stringify({ carId, text }) });

const ImportPresignSchema = z.object({ key: z.string(), uploadUrl: z.string().url() });
const CreateJobResponseSchema = z.object({ jobId: z.string().uuid() });

export const presignImportTxt = (token: string, size: number): Promise<z.infer<typeof ImportPresignSchema>> =>
  request(token, '/import/presign', ImportPresignSchema, { method: 'POST', body: JSON.stringify({ size }) });

export const createImportJob = (token: string, input: { carId: string; text?: string; s3Key?: string }): Promise<{ jobId: string }> =>
  request(token, '/import/jobs', CreateJobResponseSchema, { method: 'POST', body: JSON.stringify(input) });

export const getImportJob = (token: string, carId: string, jobId: string): Promise<ImportJob> =>
  request(token, `/import/jobs/${jobId}?carId=${encodeURIComponent(carId)}`, ImportJobSchema);

// Dismiss a finished import job so reopening bulk import starts clean instead of re-adopting
// the same completed job (and re-seeding already-committed events). Idempotent server-side.
export const deleteImportJob = (token: string, carId: string, jobId: string): Promise<void> =>
  request(token, `/import/jobs/${jobId}?carId=${encodeURIComponent(carId)}`, ImportJobSchema, { method: 'DELETE' })
    .then(() => undefined);

export const latestImportJob = async (token: string, carId: string): Promise<ImportJob | null> => {
  try {
    return await request(token, `/import/jobs?carId=${encodeURIComponent(carId)}`, ImportJobSchema);
  } catch (e) {
    if ((e as Error).message.includes('404')) return null;
    throw e;
  }
};

const ScanPresignSchema = z.object({ key: z.string(), uploadUrl: z.string().url() });
export const presignScan = (token: string, contentType: string, size: number): Promise<z.infer<typeof ScanPresignSchema>> =>
  request(token, '/import/scan/presign', ScanPresignSchema, { method: 'POST', body: JSON.stringify({ contentType, size }) });
export const extractFromScan = (token: string, carId: string, s3Key: string, contentType: string): Promise<ExtractEventsResponse> =>
  request(token, '/import/scan', ExtractEventsResponseSchema, { method: 'POST', body: JSON.stringify({ carId, s3Key, contentType }) });
export const confirmProofFromScan = (token: string, carId: string, eventId: string, s3Key: string, contentType: string, size: number) =>
  request(token, `/cars/${carId}/events/${eventId}/proofs/from-scan`, ProofSchema, { method: 'POST', body: JSON.stringify({ s3Key, contentType, size }) });

const ChatSessionListSchema = z.array(ChatSessionSummarySchema);
const chatBase = (carId: string) => `/cars/${carId}/chat`;

export const listChatSessions = (token: string, carId: string): Promise<ChatSessionSummary[]> =>
  request(token, `${chatBase(carId)}/sessions`, ChatSessionListSchema);

export const createChatSession = (token: string, carId: string): Promise<ChatSession> =>
  request(token, `${chatBase(carId)}/sessions`, ChatSessionSchema, { method: 'POST' });

export const getChatSession = (token: string, carId: string, sid: string): Promise<ChatSession> =>
  request(token, `${chatBase(carId)}/sessions/${sid}`, ChatSessionSchema);

export const renameChatSession = (token: string, carId: string, sid: string, title: string): Promise<ChatSession> =>
  request(token, `${chatBase(carId)}/sessions/${sid}`, ChatSessionSchema, { method: 'PUT', body: JSON.stringify({ title }) });

export const deleteChatSession = (token: string, carId: string, sid: string): Promise<void> =>
  request(token, `${chatBase(carId)}/sessions/${sid}`, ChatSessionSchema, { method: 'DELETE' }).then(() => undefined);

export const postChatMessage = (
  token: string, carId: string, sid: string, input: { content: string; attachments: AttachmentRef[] },
): Promise<PostMessageResponse> =>
  request(token, `${chatBase(carId)}/sessions/${sid}/messages`, PostMessageResponseSchema, { method: 'POST', body: JSON.stringify(input) });

// Resolve a pending action (a proposed delete) the assistant attached to a message.
// The server performs the delete and flips the action status, returning the new session.
export const resolveChatAction = (
  token: string, carId: string, sid: string, aid: string, confirm: boolean,
): Promise<ChatSession> =>
  request(
    token,
    `${chatBase(carId)}/sessions/${sid}/actions/${aid}/${confirm ? 'confirm' : 'decline'}`,
    ChatSessionSchema,
    { method: 'POST' },
  );

// Sends a recorded clip (16kHz mono WAV) for server-side transcription. Audio is never
// stored — the API decodes, transcribes via Amazon Transcribe, and discards it.
export async function transcribeAudio(
  token: string, carId: string, wav: ArrayBuffer, language: 'uk-UA' | 'en-US',
): Promise<string> {
  const bytes = new Uint8Array(wav);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const res = await request(
    token, `${chatBase(carId)}/transcribe`, TranscribeResponseSchema,
    { method: 'POST', body: JSON.stringify({ audio: btoa(bin), language }) },
  );
  return res.text;
}

// Presign + upload one already-prepared (downscaled) file, returning its attachment ref.
export async function uploadChatAttachment(token: string, carId: string, file: File): Promise<AttachmentRef> {
  const contentType = file.type as ScanDocContentType;
  const { key, uploadUrl } = await request(
    token, `${chatBase(carId)}/attachments/presign`, ChatAttachmentPresignResponseSchema,
    { method: 'POST', body: JSON.stringify({ contentType, size: file.size }) },
  );
  await uploadToS3(uploadUrl, file);
  return { key, contentType, filename: file.name, size: file.size };
}

const ReminderListSchema = z.array(ReminderSchema);
const reminderBase = (carId: string) => `/cars/${carId}/reminders`;

export const getReminders = (token: string, carId: string): Promise<Reminder[]> =>
  request(token, reminderBase(carId), ReminderListSchema);
export const createReminder = (token: string, carId: string, input: CreateReminderInput): Promise<Reminder> =>
  request(token, reminderBase(carId), ReminderSchema, { method: 'POST', body: JSON.stringify(input) });
export const updateReminder = (token: string, carId: string, reminderId: string, input: CreateReminderInput): Promise<Reminder> =>
  request(token, `${reminderBase(carId)}/${reminderId}`, ReminderSchema, { method: 'PUT', body: JSON.stringify(input) });
export const deleteReminder = (token: string, carId: string, reminderId: string): Promise<void> =>
  request(token, `${reminderBase(carId)}/${reminderId}`, ReminderSchema, { method: 'DELETE' }).then(() => undefined);
// 200 → the rescheduled next occurrence; 204 (one-shot, deleted) → undefined.
export const completeReminder = (token: string, carId: string, reminderId: string, input: CompleteReminderInput): Promise<Reminder | undefined> =>
  request(token, `${reminderBase(carId)}/${reminderId}/complete`, ReminderSchema, { method: 'POST', body: JSON.stringify(input) });

export const listUsers = (token: string, nextToken?: string): Promise<ListUsersResponse> => {
  const qs = nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : '';
  return request(token, `/admin/users${qs}`, ListUsersResponseSchema);
};
export const getMetrics = (token: string): Promise<MetricsResponse> =>
  request(token, '/admin/metrics', MetricsResponseSchema);
export const setUserAdmin = (token: string, username: string, makeAdmin: boolean): Promise<void> =>
  request(token, `/admin/users/${encodeURIComponent(username)}/admin`, AdminUserSchema, { method: makeAdmin ? 'PUT' : 'DELETE' })
    .then(() => undefined);
export const setUserEnabled = (token: string, username: string, enabled: boolean): Promise<void> =>
  request(token, `/admin/users/${encodeURIComponent(username)}/enabled`, AdminUserSchema, { method: 'PUT', body: JSON.stringify({ enabled }) })
    .then(() => undefined);
export const deleteUser = (token: string, username: string): Promise<void> =>
  request(token, `/admin/users/${encodeURIComponent(username)}`, AdminUserSchema, { method: 'DELETE' })
    .then(() => undefined);
