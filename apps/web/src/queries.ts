import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from 'react-oidc-context';
import type { CreateCarInput } from '@carlog/contracts';
import { createCar, deleteCar, getCar, listCars, updateCar, listPhotos, uploadPhoto, deletePhoto } from './api-client';

export function useCars() {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  return useQuery({ queryKey: ['cars'], queryFn: () => listCars(token), enabled: Boolean(token) });
}

export function useCreateCar() {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCarInput) => createCar(token, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars'] }),
  });
}

export function useCar(id: string) {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  return useQuery({
    queryKey: ['cars', id],
    queryFn: () => getCar(token, id),
    enabled: Boolean(token && id),
  });
}

export function useUpdateCar(id: string) {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
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
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCar(token, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars'] }),
  });
}

export function usePhotos(carId: string) {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  return useQuery({
    queryKey: ['cars', carId, 'photos'],
    queryFn: () => listPhotos(token, carId),
    enabled: Boolean(token && carId),
  });
}

export function useUploadPhoto(carId: string) {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadPhoto(token, carId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'photos'] }),
  });
}

export function useDeletePhoto(carId: string) {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => deletePhoto(token, carId, photoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'photos'] }),
  });
}
