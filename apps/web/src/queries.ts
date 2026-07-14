import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from 'react-oidc-context';
import type { CreateCarInput } from '@carlog/contracts';
import { createCar, deleteCar, getCar, listCars, updateCar } from './api-client';

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
