import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useTodosBusy } from './useTodosBusy'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function createWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

const todoA: Todo = { ...todoFixture, id: 1, title: 'Task A' }
const todoB: Todo = { ...todoFixture, id: 2, title: 'Task B' }

function setup() {
  const client = createClient()
  const { result } = renderHook(() => useUpdateTodoMutation(), {
    wrapper: createWrapper(client),
  })
  return { client, result }
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('useUpdateTodoMutation', () => {
  it('calls the update API with the id and partial input and replaces the matching todo in the cached list', async () => {
    const saved: Todo = { ...todoB, title: 'Renamed' }
    vi.mocked(todosApi.update).mockResolvedValue(saved)
    const { client, result } = setup()
    client.setQueryData(todoKeys.list, [todoA, todoB])

    await act(async () => {
      await result.current.mutateAsync({ id: 2, input: { title: 'Renamed' } })
    })

    expect(todosApi.update).toHaveBeenCalledTimes(1)
    expect(todosApi.update).toHaveBeenCalledWith(2, { title: 'Renamed' })
    expect(client.getQueryData(todoKeys.list)).toEqual([todoA, saved])
  })

  it('does not create a list in the cache when no list is cached yet', async () => {
    vi.mocked(todosApi.update).mockResolvedValue({ ...todoB, title: 'Renamed' })
    const { client, result } = setup()

    await act(async () => {
      await result.current.mutateAsync({ id: 2, input: { title: 'Renamed' } })
    })

    expect(client.getQueryData(todoKeys.list)).toBeUndefined()
  })

  it('cancels in-flight list queries before writing the saved todo', async () => {
    const edited: Todo = { ...todoA, title: 'Edited A' }
    vi.mocked(todosApi.update).mockResolvedValue(edited)
    const { client, result } = setup()
    client.setQueryData(todoKeys.list, [todoA])
    let resolveStale: (todos: Todo[]) => void = () => {}
    const stale = new Promise<Todo[]>((resolve) => {
      resolveStale = resolve
    })
    const inFlight = client
      .fetchQuery({ queryKey: todoKeys.list, queryFn: () => stale, staleTime: 0 })
      .catch(() => undefined)

    await act(async () => {
      await result.current.mutateAsync({ id: 1, input: { title: 'Edited A' } })
    })
    await act(async () => {
      resolveStale([todoA])
      await inFlight
    })

    expect(client.getQueryData(todoKeys.list)).toEqual([edited])
  })

  it('leaves the cache unchanged when the update API rejects', async () => {
    const error = new Error('Could not update.')
    vi.mocked(todosApi.update).mockRejectedValue(error)
    const { client, result } = setup()
    client.setQueryData(todoKeys.list, [todoA])

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 1, input: { title: 'Renamed' } }),
      ).rejects.toThrow(error)
    })

    expect(client.getQueryData(todoKeys.list)).toEqual([todoA])
  })

  it('reports todos busy while the update mutation is pending and not after it settles', async () => {
    let release: (todo: Todo) => void = () => {}
    const pending = new Promise<Todo>((resolve) => {
      release = resolve
    })
    vi.mocked(todosApi.update).mockReturnValue(pending)
    const client = createClient()
    const { result } = renderHook(
      () => ({ busy: useTodosBusy(), update: useUpdateTodoMutation() }),
      { wrapper: createWrapper(client) },
    )

    expect(result.current.busy).toBe(false)

    act(() => {
      result.current.update.mutate({ id: 1, input: { title: 'Renamed' } })
    })
    await waitFor(() => expect(result.current.busy).toBe(true))

    await act(async () => {
      release({ ...todoA, title: 'Renamed' })
    })
    await waitFor(() => expect(result.current.busy).toBe(false))
  })
})
