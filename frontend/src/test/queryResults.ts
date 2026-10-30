import type {
  QueryObserverBaseResult,
  UseMutationResult,
  UseQueryResult,
} from '@tanstack/react-query'
import { vi } from 'vitest'

type QueryStateKey =
  | 'data'
  | 'error'
  | 'isError'
  | 'isPending'
  | 'isLoading'
  | 'isLoadingError'
  | 'isRefetchError'
  | 'isSuccess'
  | 'isPlaceholderData'
  | 'status'

type QueryOverrides<Data> = Partial<
  Omit<QueryObserverBaseResult<Data, Error>, QueryStateKey>
>

type MutationOverrides<Data, Variables> = Partial<
  Pick<
    UseMutationResult<Data, Error, Variables>,
    'mutate' | 'mutateAsync' | 'reset' | 'isPaused'
  >
>

function baseQuery<Data>(
  overrides: QueryOverrides<Data>,
): Omit<QueryObserverBaseResult<Data, Error>, QueryStateKey> {
  return {
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    errorUpdateCount: 0,
    failureCount: 0,
    failureReason: null,
    fetchStatus: 'idle',
    isEnabled: true,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isInitialLoading: false,
    isPaused: false,
    isRefetching: false,
    isStale: false,
    refetch: vi.fn(),
    ...overrides,
  }
}

export function successQuery<Data>(
  data: Data,
  overrides: QueryOverrides<Data> = {},
): UseQueryResult<Data, Error> {
  return {
    ...baseQuery(overrides),
    data,
    error: null,
    isError: false,
    isPending: false,
    isLoading: false,
    isLoadingError: false,
    isRefetchError: false,
    isSuccess: true,
    isPlaceholderData: false,
    status: 'success',
  }
}

export function pendingQuery<Data>(
  overrides: QueryOverrides<Data> = {},
): UseQueryResult<Data, Error> {
  return {
    ...baseQuery({
      fetchStatus: 'fetching',
      isFetched: false,
      isFetchedAfterMount: false,
      isFetching: true,
      isInitialLoading: true,
      ...overrides,
    }),
    data: undefined,
    error: null,
    isError: false,
    isPending: true,
    isLoading: true,
    isLoadingError: false,
    isRefetchError: false,
    isSuccess: false,
    isPlaceholderData: false,
    status: 'pending',
  }
}

export function loadingErrorQuery<Data>(
  error: Error,
  overrides: QueryOverrides<Data> = {},
): UseQueryResult<Data, Error> {
  return {
    ...baseQuery({ failureCount: 1, failureReason: error, ...overrides }),
    data: undefined,
    error,
    isError: true,
    isPending: false,
    isLoading: false,
    isLoadingError: true,
    isRefetchError: false,
    isSuccess: false,
    isPlaceholderData: false,
    status: 'error',
  }
}

export function refetchErrorQuery<Data>(
  data: Data,
  error: Error,
  overrides: QueryOverrides<Data> = {},
): UseQueryResult<Data, Error> {
  return {
    ...baseQuery({ failureCount: 1, failureReason: error, ...overrides }),
    data,
    error,
    isError: true,
    isPending: false,
    isLoading: false,
    isLoadingError: false,
    isRefetchError: true,
    isSuccess: false,
    isPlaceholderData: false,
    status: 'error',
  }
}

function baseMutation<Data, Variables>(
  overrides: MutationOverrides<Data, Variables>,
) {
  return {
    context: undefined,
    failureCount: 0,
    failureReason: null,
    isPaused: false,
    submittedAt: 0,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

export function idleMutation<Data, Variables>(
  overrides: MutationOverrides<Data, Variables> = {},
): UseMutationResult<Data, Error, Variables> {
  return {
    ...baseMutation(overrides),
    data: undefined,
    variables: undefined,
    error: null,
    isError: false,
    isIdle: true,
    isPending: false,
    isSuccess: false,
    status: 'idle',
  }
}

export function pendingMutation<Data, Variables>(
  variables: Variables,
  overrides: MutationOverrides<Data, Variables> = {},
): UseMutationResult<Data, Error, Variables> {
  return {
    ...baseMutation(overrides),
    submittedAt: 1,
    data: undefined,
    variables,
    error: null,
    isError: false,
    isIdle: false,
    isPending: true,
    isSuccess: false,
    status: 'pending',
  }
}

export function errorMutation<Data, Variables>(
  error: Error,
  variables: Variables,
  overrides: MutationOverrides<Data, Variables> = {},
): UseMutationResult<Data, Error, Variables> {
  return {
    ...baseMutation(overrides),
    submittedAt: 1,
    failureCount: 1,
    failureReason: error,
    data: undefined,
    variables,
    error,
    isError: true,
    isIdle: false,
    isPending: false,
    isSuccess: false,
    status: 'error',
  }
}

export function successMutation<Data, Variables>(
  data: Data,
  variables: Variables,
  overrides: MutationOverrides<Data, Variables> = {},
): UseMutationResult<Data, Error, Variables> {
  return {
    ...baseMutation(overrides),
    submittedAt: 1,
    data,
    variables,
    error: null,
    isError: false,
    isIdle: false,
    isPending: false,
    isSuccess: true,
    status: 'success',
  }
}
