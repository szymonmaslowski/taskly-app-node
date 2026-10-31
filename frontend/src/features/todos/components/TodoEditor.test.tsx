import type { UseMutationResult } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import {
  errorMutation,
  idleMutation,
  pendingMutation,
} from '../../../test/queryResults'
import { todoFixture } from '../../../test/todoFixture'
import { useCreateTodoMutation } from '../hooks/useCreateTodoMutation'
import { useUpdateTodoMutation } from '../hooks/useUpdateTodoMutation'
import type { Todo, TodoInput } from '../types'
import { TodoEditor } from './TodoEditor'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useCreateTodoMutation', () => ({
  useCreateTodoMutation: vi.fn(),
}))
vi.mock('../hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./TodoForm', () => ({
  TodoForm: ({
    onSubmit,
    initial,
    busy,
    error,
  }: {
    onSubmit: (input: TodoInput) => Promise<void>
    initial?: TodoInput
    busy: boolean
    error: string | null
  }) => (
    <div>
      <p>Initial: {String(JSON.stringify(initial))}</p>
      <p>Busy: {String(busy)}</p>
      <p>Error: {error === null ? 'null' : `"${error}"`}</p>
      <button onClick={() => void onSubmit(todoFixture)}>Submit form</button>
    </div>
  ),
}))

type UpdateVariables = { id: number; input: Partial<TodoInput> }

function setup({
  create = idleMutation<Todo, TodoInput>(),
  update = idleMutation<Todo, UpdateVariables>(),
}: {
  create?: UseMutationResult<Todo, Error, TodoInput>
  update?: UseMutationResult<Todo, Error, UpdateVariables>
} = {}) {
  vi.mocked(useCreateTodoMutation).mockReturnValue(create)
  vi.mocked(useUpdateTodoMutation).mockReturnValue(update)
  return { onSaved: vi.fn(), onClose: vi.fn() }
}

it('creates a new task and reports a successful save', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockResolvedValue(todoFixture)
  const update = vi.fn()
  vi.mocked(useCreateTodoMutation).mockReturnValue(
    idleMutation({ mutateAsync: create }),
  )
  vi.mocked(useUpdateTodoMutation).mockReturnValue(
    idleMutation({ mutateAsync: update }),
  )
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('New task added.'))
  expect(create).toHaveBeenCalledWith(todoFixture)
  expect(update).not.toHaveBeenCalled()
})

it('updates an existing task and reports saved changes', async () => {
  const user = userEvent.setup()
  const create = vi.fn<(input: TodoInput) => Promise<Todo>>()
  const update = vi.fn<(variables: UpdateVariables) => Promise<Todo>>()
  update.mockResolvedValue(todoFixture)
  const { onSaved } = setup({
    create: idleMutation({ mutateAsync: create }),
    update: idleMutation({ mutateAsync: update }),
  })
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Changes saved.'))
  expect(update).toHaveBeenCalledWith({ id: 7, input: todoFixture })
  expect(create).not.toHaveBeenCalled()
})

it('does not report a save and keeps the editor open when the mutation fails', async () => {
  const user = userEvent.setup()
  const create = vi.fn<(input: TodoInput) => Promise<Todo>>()
  create.mockRejectedValue(new Error('Create failed.'))
  const { onSaved, onClose } = setup({
    create: idleMutation({ mutateAsync: create }),
  })
  render(
    <TodoEditor todo="new" busy={false} onClose={onClose} onSaved={onSaved} />,
  )
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  expect(onSaved).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
})

it('passes the error of the active mutation to the form', () => {
  const create = errorMutation<Todo, TodoInput>(
    new Error('Create failed.'),
    todoFixture,
  )
  const update = errorMutation<Todo, UpdateVariables>(
    new Error('Update failed.'),
    { id: 7, input: todoFixture },
  )
  const { onSaved, onClose } = setup({ create, update })
  const { rerender } = render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={onClose}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByText('Error: "Update failed."')).toBeVisible()

  rerender(
    <TodoEditor todo="new" busy={false} onClose={onClose} onSaved={onSaved} />,
  )
  expect(screen.getByText('Error: "Create failed."')).toBeVisible()
})

it('passes a null error to the form when the mutation has no error', () => {
  const { onSaved, onClose } = setup()
  render(
    <TodoEditor todo="new" busy={false} onClose={onClose} onSaved={onSaved} />,
  )
  expect(screen.getByText('Error: null')).toBeVisible()
})

it('passes initial values only in edit mode', () => {
  const { onSaved, onClose } = setup()
  const { rerender } = render(
    <TodoEditor todo="new" busy={false} onClose={onClose} onSaved={onSaved} />,
  )
  expect(screen.getByText('Initial: undefined')).toBeVisible()

  rerender(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={onClose}
      onSaved={onSaved}
    />,
  )
  expect(
    screen.getByText(`Initial: ${JSON.stringify(todoFixture)}`),
  ).toBeVisible()
})

it('ignores a submit while busy', async () => {
  const user = userEvent.setup()
  const create = vi.fn<(input: TodoInput) => Promise<Todo>>()
  const update = vi.fn<(variables: UpdateVariables) => Promise<Todo>>()
  const { onSaved, onClose } = setup({
    create: idleMutation({ mutateAsync: create }),
    update: idleMutation({ mutateAsync: update }),
  })
  render(<TodoEditor todo="new" busy onClose={onClose} onSaved={onSaved} />)
  expect(screen.getByText('Busy: true')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(create).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('ignores a submit while the active mutation is pending', async () => {
  const user = userEvent.setup()
  const update = vi.fn<(variables: UpdateVariables) => Promise<Todo>>()
  const { onSaved, onClose } = setup({
    update: pendingMutation<Todo, UpdateVariables>(
      { id: 7, input: todoFixture },
      { mutateAsync: update },
    ),
  })
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={onClose}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByText('Busy: true')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(update).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})
