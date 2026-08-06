import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth';
import type { CreateCarInput, CreateEventInput, CreateReminderInput, CompleteReminderInput, Event, CarExport } from '@carlog/contracts';
import { createCar, deleteCar, getCar, listCars, updateCar, setCarSharing, getPublicCar, getEvents, createEvent, updateEvent, deleteEvent, listProofs, uploadProof, deleteProof, extractEvents, presignImportTxt, createImportJob, getImportJob, latestImportJob, deleteImportJob, uploadToS3, presignScan, extractFromScan, importCar, listChatSessions, createChatSession, getChatSession, renameChatSession, deleteChatSession, postChatMessage, resolveChatAction, uploadChatAttachment, getReminders, createReminder, updateReminder, deleteReminder, completeReminder, listUsers, getMetrics, setUserAdmin, setUserEnabled, deleteUser } from './api-client';
import { prepareScanFile } from './lib/prepare-scan';

export function useCars() {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  return useQuery({ queryKey: ['cars'], queryFn: () => listCars(token), enabled: Boolean(token) });
}

export function useCreateCar() {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCarInput) => createCar(token, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars'] }),
  });
}

export function useCar(id: string) {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  return useQuery({
    queryKey: ['cars', id],
    queryFn: () => getCar(token, id),
    enabled: Boolean(token && id),
  });
}

export function useUpdateCar(id: string) {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCarInput) => updateCar(token, id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cars'] });
      void qc.invalidateQueries({ queryKey: ['cars', id] });
    },
  });
}

export function useDeleteCar() {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCar(token, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars'] }),
  });
}

export function useSetCarSharing() {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ carId, shared }: { carId: string; shared: boolean }) => setCarSharing(token, carId, shared),
    onSuccess: (_data, { carId }) => {
      void qc.invalidateQueries({ queryKey: ['cars', carId] });
      void qc.invalidateQueries({ queryKey: ['cars'] });
    },
  });
}

export function useImportCar() {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: CarExport) => importCar(token, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars'] }),
  });
}

export function usePublicCar(carId: string) {
  return useQuery({
    queryKey: ['public', carId],
    queryFn: () => getPublicCar(carId),
    enabled: Boolean(carId),
    retry: false,
  });
}


export function useEvents(carId: string) {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  return useQuery({ queryKey: ['cars', carId, 'events'], queryFn: () => getEvents(token, carId), enabled: Boolean(token && carId) });
}
// Event create/update may bump car.mileage server-side — refresh the car queries too,
// so the vehicle hero, reminder dueness, and garage badge don't go stale.
function invalidateEventsAndCar(qc: ReturnType<typeof useQueryClient>, carId: string) {
  void qc.invalidateQueries({ queryKey: ['cars', carId, 'events'] });
  void qc.invalidateQueries({ queryKey: ['cars', carId] });
  void qc.invalidateQueries({ queryKey: ['cars'] });
}
export function useCreateEvent(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateEventInput) => createEvent(token, carId, input), onSuccess: () => invalidateEventsAndCar(qc, carId) });
}
export function useUpdateEvent(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: ({ eventId, input }: { eventId: string; input: CreateEventInput }) => updateEvent(token, carId, eventId, input), onSuccess: () => invalidateEventsAndCar(qc, carId) });
}
export function useDeleteEvent(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  const key = ['cars', carId, 'events'];
  // Optimistic delete: drop the row from the cached list immediately so the timeline
  // responds instantly, then roll back if the request fails.
  return useMutation({
    mutationFn: (eventId: string) => deleteEvent(token, carId, eventId),
    onMutate: async (eventId: string) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Event[]>(key);
      qc.setQueryData<Event[]>(key, (old) => (old ?? []).filter((e) => e.id !== eventId));
      return { prev };
    },
    onError: (_err, _eventId, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
export function useProofs(carId: string, eventId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({ queryKey: ['cars', carId, 'events', eventId, 'proofs'], queryFn: () => listProofs(token, carId, eventId), enabled: Boolean(token && carId && eventId) });
}
export function useUploadProof(carId: string, eventId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (file: File) => uploadProof(token, carId, eventId, file), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'events', eventId, 'proofs'] }) });
}
export function useDeleteProof(carId: string, eventId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (proofId: string) => deleteProof(token, carId, eventId, proofId), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'events', eventId, 'proofs'] }) });
}

export function useExtractEvents(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useMutation({ mutationFn: (text: string) => extractEvents(token, carId, text) });
}

export function useCreateImportJob(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useMutation({
    mutationFn: async (input: { text?: string; file?: File }) => {
      if (input.file) {
        const { key, uploadUrl } = await presignImportTxt(token, input.file.size);
        await uploadToS3(uploadUrl, input.file);
        return createImportJob(token, { carId, s3Key: key });
      }
      return createImportJob(token, { carId, text: input.text ?? '' });
    },
  });
}

export function useImportJob(carId: string, jobId: string | undefined) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({
    queryKey: ['cars', carId, 'importJobs', jobId],
    queryFn: () => getImportJob(token, carId, jobId ?? ''),
    enabled: Boolean(token && carId && jobId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'pending' || s === 'running' ? 2500 : false;
    },
  });
}

export function useLatestImportJob(carId: string, enabled: boolean) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({
    queryKey: ['cars', carId, 'importJobs', 'latest'],
    queryFn: () => latestImportJob(token, carId),
    enabled: Boolean(token && carId && enabled),
    staleTime: 0,
  });
}

export function useDeleteImportJob(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => deleteImportJob(token, carId, jobId),
    // Drop the cached latest/keyed job so a reopened dialog can't re-adopt the dismissed job.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'importJobs'] }),
  });
}

export function useExtractFromScan(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      const { key, uploadUrl } = await presignScan(token, file.type, file.size);
      await uploadToS3(uploadUrl, file);
      const { events } = await extractFromScan(token, carId, key, file.type);
      return { events, s3Key: key, contentType: file.type, size: file.size };
    },
  });
}

export function useReminders(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({ queryKey: ['cars', carId, 'reminders'], queryFn: () => getReminders(token, carId), enabled: Boolean(token && carId) });
}
export function useCreateReminder(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateReminderInput) => createReminder(token, carId, input), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] }) });
}
export function useUpdateReminder(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: ({ reminderId, input }: { reminderId: string; input: CreateReminderInput }) => updateReminder(token, carId, reminderId, input), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] }) });
}
export function useDeleteReminder(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (reminderId: string) => deleteReminder(token, carId, reminderId), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] }) });
}
export function useCompleteReminder(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reminderId, input }: { reminderId: string; input: CompleteReminderInput }) => completeReminder(token, carId, reminderId, input),
    // Completion may bump car.mileage server-side — refresh the car too.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] });
      void qc.invalidateQueries({ queryKey: ['cars', carId] });
      void qc.invalidateQueries({ queryKey: ['cars'] });
    },
  });
}

export function useAdminUsers() {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({ queryKey: ['admin', 'users'], queryFn: () => listUsers(token), enabled: Boolean(token) });
}
export function useAdminMetrics() {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({ queryKey: ['admin', 'metrics'], queryFn: () => getMetrics(token), enabled: Boolean(token), staleTime: 5 * 60_000 });
}
export function useSetUserAdmin() {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, makeAdmin }: { username: string; makeAdmin: boolean }) =>
      setUserAdmin(token, username, makeAdmin),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}
export function useSetUserEnabled() {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, enabled }: { username: string; enabled: boolean }) => setUserEnabled(token, username, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}
export function useDeleteUser() {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username }: { username: string }) => deleteUser(token, username),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

// Per-car AI chat sessions (persisted, 7-day TTL server-side).
const chatSessionsKey = (carId: string) => ['cars', carId, 'chat', 'sessions'];
const chatSessionKey = (carId: string, sid: string) => ['cars', carId, 'chat', 'sessions', sid];

export function useChatSessions(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({ queryKey: chatSessionsKey(carId), queryFn: () => listChatSessions(token, carId), enabled: Boolean(token && carId) });
}

export function useChatSession(carId: string, sid: string | undefined) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  // retry:false so a stale/expired/deleted session id fails fast — the panel resets ?chat.
  return useQuery({ queryKey: chatSessionKey(carId, sid ?? ''), queryFn: () => getChatSession(token, carId, sid ?? ''), enabled: Boolean(token && carId && sid), retry: false });
}

export function useCreateChatSession(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: () => createChatSession(token, carId),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatSessionsKey(carId) }),
  });
}

export function useRenameChatSession(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sid, title }: { sid: string; title: string }) => renameChatSession(token, carId, sid, title),
    onSuccess: (_d, { sid }) => {
      void qc.invalidateQueries({ queryKey: chatSessionsKey(carId) });
      void qc.invalidateQueries({ queryKey: chatSessionKey(carId, sid) });
    },
  });
}

export function useDeleteChatSession(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: (sid: string) => deleteChatSession(token, carId, sid),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatSessionsKey(carId) }),
  });
}

// Sends a turn: downscales + uploads each attachment (images shrunk via prepareScanFile,
// PDFs as-is), then posts the message with the resulting S3 keys.
export function usePostChatMessage(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sid, content, files }: { sid: string; content: string; files: File[] }) => {
      const attachments = await Promise.all(files.map(async (f) => {
        const prepared = f.type.startsWith('image/') ? await prepareScanFile(f) : f;
        return uploadChatAttachment(token, carId, prepared);
      }));
      return postChatMessage(token, carId, sid, { content, attachments });
    },
    onSuccess: (res, { sid }) => {
      qc.setQueryData(chatSessionKey(carId, sid), res.session);
      void qc.invalidateQueries({ queryKey: chatSessionsKey(carId) });
      // A turn may have created/updated events, reminders, or the car's odometer.
      const changed = res.session.messages.at(-1)?.actions.some((a) => a.status === 'done') ?? false;
      if (changed) {
        invalidateEventsAndCar(qc, carId);
        void qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] });
      }
    },
  });
}

// Confirming a delete changes events/reminders server-side, so refresh those views too.
export function useResolveChatAction(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sid, aid, confirm }: { sid: string; aid: string; confirm: boolean }) =>
      resolveChatAction(token, carId, sid, aid, confirm),
    onSuccess: (session, { sid }) => {
      qc.setQueryData(chatSessionKey(carId, sid), session);
      invalidateEventsAndCar(qc, carId);
      void qc.invalidateQueries({ queryKey: ['cars', carId, 'reminders'] });
    },
  });
}
