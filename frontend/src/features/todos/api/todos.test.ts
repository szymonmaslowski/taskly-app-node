import { beforeEach, expect, it, vi } from 'vitest'
import { request } from '../../../lib/http'
import { todoFixture } from '../../../test/todoFixture'
import { todosApi } from './todos'

vi.mock('../../../lib/http', () => ({ request: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('passes the abort signal when fetching tasks', async () => {
  const signal = new AbortController().signal
  vi.mocked(request).mockResolvedValue([todoFixture])
  await expect(todosApi.list(signal)).resolves.toEqual([todoFixture])
  expect(request).toHaveBeenCalledWith('/todos', { signal })
})

it('sends only writable task fields on creation', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await expect(todosApi.create(todoFixture)).resolves.toEqual(todoFixture)
  expect(request).toHaveBeenCalledWith('/todos', {
    method: 'POST',
    body: JSON.stringify({
      title: todoFixture.title,
      description: '',
      priority: 'medium',
      due_date: null,
      completed: false,
    }),
  })
})

it('patches only the given writable fields to the task path', async () => {
  const updated = { ...todoFixture, completed: true }
  vi.mocked(request).mockResolvedValue(updated)
  await expect(todosApi.update(7, { completed: true })).resolves.toEqual(
    updated,
  )
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith('/todos/7', {
    method: 'PATCH',
    body: JSON.stringify({ completed: true }),
  })
})

it('strips read-only fields when updating a task', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await todosApi.update(7, todoFixture)
  expect(request).toHaveBeenCalledWith('/todos/7', {
    method: 'PATCH',
    body: JSON.stringify({
      title: todoFixture.title,
      description: todoFixture.description,
      priority: todoFixture.priority,
      due_date: todoFixture.due_date,
      completed: todoFixture.completed,
    }),
  })
})

it('sends a DELETE to the task path and resolves with no value', async () => {
  vi.mocked(request).mockResolvedValue(undefined)
  await expect(todosApi.remove(7)).resolves.toBeUndefined()
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith('/todos/7', { method: 'DELETE' })
})
