import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { request } from './http'

const connectionMessage = 'Cannot connect to the server. Please try again.'
const genericMessage = 'The operation failed. Please try again.'

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

it('returns parsed JSON and calls fetch with the /api prefix and JSON content type', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ id: 1 }))

  const result = await request('/todos')

  expect(result).toEqual({ id: 1 })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledWith('/api/todos', {
    headers: { 'Content-Type': 'application/json' },
  })
})

it('merges caller headers and passes other init options through', async () => {
  fetchMock.mockImplementation(async () => jsonResponse({}))

  await request('/todos', {
    method: 'POST',
    body: '{}',
    headers: { 'X-Test': '1' },
  })
  await request('/todos', { headers: { 'Content-Type': 'text/plain' } })

  expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/todos', {
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json', 'X-Test': '1' },
  })
  expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/todos', {
    headers: { 'Content-Type': 'text/plain' },
  })
})

it('resolves undefined on 204 without reading the body', async () => {
  const response = new Response(null, { status: 204 })
  const json = vi
    .spyOn(response, 'json')
    .mockRejectedValue(new SyntaxError('Unexpected end of JSON input'))
  fetchMock.mockResolvedValue(response)

  await expect(
    request('/todos/1', { method: 'DELETE' }),
  ).resolves.toBeUndefined()
  expect(json).not.toHaveBeenCalled()
})

it('throws the connection message when fetch fails', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

  await expect(request('/todos')).rejects.toThrow(connectionMessage)
})

it('rethrows the original error when the request was aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const abortError = new DOMException(
    'The operation was aborted.',
    'AbortError',
  )
  fetchMock.mockRejectedValue(abortError)

  await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
    abortError,
  )
})

it('throws the connection message when fetch fails with a signal that is not aborted', async () => {
  const controller = new AbortController()
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

  const result = request('/todos', { signal: controller.signal })

  await expect(result).rejects.toThrow(connectionMessage)
  await expect(result).rejects.not.toBeInstanceOf(TypeError)
})

it('throws the fixed validation message on 422 whatever the body says', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ detail: 'some server text' }, 422))

  await expect(request('/todos')).rejects.toThrow(
    'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.',
  )
})

it('throws the string detail from an error response', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ detail: 'Task not found.' }, 404))

  await expect(request('/todos/9')).rejects.toThrow('Task not found.')
})

it.each([
  ['a non-JSON body', () => new Response('<html>oops</html>', { status: 500 })],
  ['a non-string detail', () => jsonResponse({ detail: ['x'] }, 500)],
  ['an empty object', () => jsonResponse({}, 500)],
  ['a null body', () => jsonResponse(null, 500)],
])(
  'throws the generic message when the error response has %s',
  async (_name, makeResponse) => {
    fetchMock.mockResolvedValue(makeResponse())

    await expect(request('/todos')).rejects.toThrow(genericMessage)
  },
)
