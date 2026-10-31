import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import {
  errorMutation,
  idleMutation,
  pendingMutation,
} from '../../../test/queryResults'
import { todoFixture } from '../../../test/todoFixture'
import { useDeleteTodoMutation } from '../hooks/useDeleteTodoMutation'
import { DeleteTodoDialog } from './DeleteTodoDialog'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useDeleteTodoMutation', () => ({
  useDeleteTodoMutation: vi.fn(),
}))

it('shows a deletion error and allows cancelling without deleting', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn()
  vi.mocked(useDeleteTodoMutation).mockReturnValue(
    errorMutation(new Error('Could not delete.'), todoFixture.id, {
      mutateAsync,
    }),
  )
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  render(
    <DeleteTodoDialog
      todo={todoFixture}
      busy={false}
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'Delete task?' })).toBeVisible()
  expect(
    screen.getByText(
      `The task “${todoFixture.title}” will be permanently deleted.`,
    ),
  ).toBeVisible()
  expect(screen.getByTestId('alert')).toHaveTextContent('Could not delete.')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(mutateAsync).not.toHaveBeenCalled()
  expect(onDeleted).not.toHaveBeenCalled()
})

it('deletes the task and reports it when confirmed', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn<(id: number) => Promise<void>>()
  mutateAsync.mockResolvedValue(undefined)
  vi.mocked(useDeleteTodoMutation).mockReturnValue(
    idleMutation({ mutateAsync }),
  )
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  render(
    <DeleteTodoDialog
      todo={todoFixture}
      busy={false}
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  expect(mutateAsync).toHaveBeenCalledWith(todoFixture.id)
  expect(onDeleted).toHaveBeenCalledTimes(1)
  expect(onClose).not.toHaveBeenCalled()
})

it('keeps the dialog open and does not report deletion when the mutation fails', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn<(id: number) => Promise<void>>()
  mutateAsync.mockRejectedValue(new Error('Could not delete.'))
  vi.mocked(useDeleteTodoMutation).mockReturnValue(
    idleMutation({ mutateAsync }),
  )
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  render(
    <DeleteTodoDialog
      todo={todoFixture}
      busy={false}
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  expect(onDeleted).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'Delete task?' })).toBeVisible()
})

it.each([
  { busy: true, isPending: false },
  { busy: false, isPending: true },
])(
  'shows a deleting state and disables both buttons when %j',
  ({ busy, isPending }) => {
    vi.mocked(useDeleteTodoMutation).mockReturnValue(
      isPending ? pendingMutation(todoFixture.id) : idleMutation(),
    )
    render(
      <DeleteTodoDialog
        todo={todoFixture}
        busy={busy}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Delete task' }),
    ).not.toBeInTheDocument()
  },
)

it('shows an enabled delete button when neither busy nor pending', () => {
  vi.mocked(useDeleteTodoMutation).mockReturnValue(idleMutation())
  render(
    <DeleteTodoDialog
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onDeleted={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: 'Delete task' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
})
