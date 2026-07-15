import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth';
import type { CreateCarInput, CreateEventInput } from '@carlog/contracts';
import { createCar, deleteCar, getCar, listCars, updateCar, listPhotos, uploadPhoto, deletePhoto, getEvents, createEvent, updateEvent, deleteEvent, listProofs, uploadProof, deleteProof, extractEvents, presignImportTxt, createImportJob, getImportJob, latestImportJob, uploadToS3, presignScan, extractFromScan } from './api-client';

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

export function usePhotos(carId: string) {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  return useQuery({
    queryKey: ['cars', carId, 'photos'],
    queryFn: () => listPhotos(token, carId),
    enabled: Boolean(token && carId),
  });
}

export function useUploadPhoto(carId: string) {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadPhoto(token, carId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'photos'] }),
  });
}

export function useDeletePhoto(carId: string) {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => deletePhoto(token, carId, photoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'photos'] }),
  });
}

export function useEvents(carId: string) {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  return useQuery({ queryKey: ['cars', carId, 'events'], queryFn: () => getEvents(token, carId), enabled: Boolean(token && carId) });
}
export function useCreateEvent(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateEventInput) => createEvent(token, carId, input), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'events'] }) });
}
export function useUpdateEvent(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: ({ eventId, input }: { eventId: string; input: CreateEventInput }) => updateEvent(token, carId, eventId, input), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'events'] }) });
}
export function useDeleteEvent(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (eventId: string) => deleteEvent(token, carId, eventId), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'events'] }) });
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
