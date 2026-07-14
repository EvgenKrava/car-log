import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth';
import type { CreateCarInput, CreateEventInput } from '@carlog/contracts';
import { createCar, deleteCar, getCar, listCars, updateCar, listPhotos, uploadPhoto, deletePhoto, getEvents, createEvent, updateEvent, deleteEvent, listProofs, uploadProof, deleteProof, extractEvents } from './api-client';

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
