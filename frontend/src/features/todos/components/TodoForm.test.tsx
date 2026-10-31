import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TodoForm } from './TodoForm'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

describe('TodoForm', () => {
  it('rejects a whitespace-only title without submitting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '   ')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.getByText('Enter a task title.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed values and the selected priority', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '  Prepare a demo  ')
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Prepare a demo',
      description: '',
      priority: 'high',
      due_date: null,
      completed: false,
    })
  })

  it('prefills fields from initial values and submits edits with trimmed description and due date', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        initial={{
          title: 'Old',
          description: 'Notes',
          priority: 'low',
          due_date: '2026-12-01',
          completed: true,
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    expect(screen.getByLabelText(/Task title/)).toHaveValue('Old')
    expect(screen.getByLabelText(/Description/)).toHaveValue('Notes')
    expect(screen.getByLabelText('Priority')).toHaveValue('low')
    expect(screen.getByLabelText(/Due date/)).toHaveValue('2026-12-01')

    await user.clear(screen.getByLabelText(/Description/))
    await user.type(screen.getByLabelText(/Description/), '  New notes  ')
    await user.clear(screen.getByLabelText(/Due date/))
    await user.type(screen.getByLabelText(/Due date/), '2026-12-24')
    await user.click(screen.getByRole('button', { name: 'Save task' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Old',
      description: 'New notes',
      priority: 'low',
      due_date: '2026-12-24',
      completed: true,
    })
  })

  it('submits null due date after the date is cleared', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        initial={{
          title: 'Old',
          description: '',
          priority: 'medium',
          due_date: '2026-12-01',
          completed: false,
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.clear(screen.getByLabelText(/Due date/))
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Old',
      description: '',
      priority: 'medium',
      due_date: null,
      completed: false,
    })
  })

  it.each([
    {
      field: 'description',
      description: 'a'.repeat(2001),
      due_date: null,
      message: 'The description must be at most 2000 characters.',
    },
    {
      field: 'due date',
      description: '',
      due_date: '2026-02-30',
      message: 'Enter a valid date.',
    },
  ])(
    'shows a validation message for an invalid $field without submitting',
    async ({ description, due_date, message }) => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()
      render(
        <TodoForm
          initial={{
            title: 'Task',
            description,
            priority: 'medium',
            due_date,
            completed: false,
          }}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          busy={false}
          error={null}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Save task' }))
      expect(screen.getByText(message)).toBeVisible()
      expect(onSubmit).not.toHaveBeenCalled()
    },
  )

  it('disables fields and shows Saving… while busy', () => {
    const { rerender } = render(
      <TodoForm onSubmit={vi.fn()} onCancel={vi.fn()} busy error={null} />,
    )
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText(/Task title/)).toBeDisabled()

    rerender(
      <TodoForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    expect(screen.getByRole('button', { name: 'Save task' })).toBeEnabled()
    expect(screen.getByLabelText(/Task title/)).toBeEnabled()
  })

  it('shows the server error and forwards cancel', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={onCancel}
        busy={false}
        error="Could not save."
      />,
    )
    expect(screen.getByText('Could not save.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()

    rerender(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={onCancel}
        busy={false}
        error={null}
      />,
    )
    expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
  })
})
