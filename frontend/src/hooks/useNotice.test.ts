import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useNotice } from './useNotice'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

it('starts without a notice and exposes a notification callback', () => {
  const { result } = renderHook(() => useNotice())
  expect(result.current.message).toBe('')
  expect(result.current.notify).toEqual(expect.any(Function))
})

it('exposes the notified message', () => {
  const { result } = renderHook(() => useNotice())

  act(() => result.current.notify('Task saved'))

  expect(result.current.message).toBe('Task saved')
})

it('clears the message after 4000 ms', () => {
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('Saved'))

  act(() => {
    vi.advanceTimersByTime(3999)
  })
  expect(result.current.message).toBe('Saved')

  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(result.current.message).toBe('')
})

it('restarts the dismiss timer when a new notice replaces the current one', () => {
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('First'))
  act(() => {
    vi.advanceTimersByTime(3000)
  })
  act(() => result.current.notify('Second'))

  act(() => {
    vi.advanceTimersByTime(3000)
  })
  expect(result.current.message).toBe('Second')

  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(result.current.message).toBe('')
})

it('repeating the same message restarts the dismiss timer', () => {
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('Saved'))
  act(() => {
    vi.advanceTimersByTime(3000)
  })
  act(() => result.current.notify('Saved'))

  act(() => {
    vi.advanceTimersByTime(3000)
  })
  expect(result.current.message).toBe('Saved')

  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(result.current.message).toBe('')
})
