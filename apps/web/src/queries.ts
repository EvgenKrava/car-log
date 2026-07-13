import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from 'react-oidc-context';
import type { CreateCarInput } from '@carlog/contracts';
import { createCar, listCars } from './api-client';

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
