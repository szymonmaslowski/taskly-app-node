import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'

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

const todo1: Todo = { ...todoFixture, id: 1, title: 'Task 1' }
const todo2: Todo = { ...todoFixture, id: 2, title: 'Task 2' }

function setup() {
  const client = createClient()
  const { result } = renderHook(() => useDeleteTodoMutation(), {
    wrapper: createWrapper(client),
  })
  return { client, result }
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('useDeleteTodoMutation', () => {
  it('calls the remove API with the id and removes that todo from the cached list', async () => {
    vi.mocked(todosApi.remove).mockResolvedValue(undefined)
    const { client, result } = setup()
    client.setQueryData(todoKeys.list, [todo1, todo2])

    await act(async () => {
      await result.current.mutateAsync(2)
    })

    expect(todosApi.remove).toHaveBeenCalledTimes(1)
    expect(todosApi.remove).toHaveBeenCalledWith(2)
    expect(client.getQueryData(todoKeys.list)).toEqual([todo1])
  })

  it('keeps the cache empty when no list is cached', async () => {
    vi.mocked(todosApi.remove).mockResolvedValue(undefined)
    const { client, result } = setup()

    await act(async () => {
      await result.current.mutateAsync(2)
    })

    expect(client.getQueryData(todoKeys.list)).toBeUndefined()
  })

  it('leaves the cache unchanged when the remove API rejects', async () => {
    const error = new Error('Could not delete.')
    vi.mocked(todosApi.remove).mockRejectedValue(error)
    const { client, result } = setup()
    client.setQueryData(todoKeys.list, [todo1, todo2])

    await act(async () => {
      await expect(result.current.mutateAsync(1)).rejects.toThrow(error)
    })

    expect(client.getQueryData(todoKeys.list)).toEqual([todo1, todo2])
  })

  it('cancels in-flight list queries so a stale refetch cannot restore the deleted todo', async () => {
    vi.mocked(todosApi.remove).mockResolvedValue(undefined)
    const { client, result } = setup()
    client.setQueryData(todoKeys.list, [todo1, todo2])
    let resolveStale: (todos: Todo[]) => void = () => {}
    const stale = new Promise<Todo[]>((resolve) => {
      resolveStale = resolve
    })
    const inFlight = client
      .fetchQuery({ queryKey: todoKeys.list, queryFn: () => stale })
      .catch(() => undefined)

    await act(async () => {
      await result.current.mutateAsync(2)
    })
    expect(client.getQueryData(todoKeys.list)).toEqual([todo1])

    await act(async () => {
      resolveStale([todo1, todo2])
      await inFlight
    })

    expect(client.getQueryData(todoKeys.list)).toEqual([todo1])
  })
})
