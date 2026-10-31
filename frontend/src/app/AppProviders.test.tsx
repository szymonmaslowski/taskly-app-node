import { useQueryClient, QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { useTheme } from 'styled-components'
import { describe, expect, it } from 'vitest'
import { theme } from '../design-system'
import { queryClient } from '../lib/queryClient'
import { AppProviders } from './AppProviders'

describe('AppProviders', () => {
  it('provides the given query client to descendants', () => {
    const client = new QueryClient()
    let received: QueryClient | undefined
    function Probe() {
      received = useQueryClient()
      return null
    }

    render(
      <AppProviders client={client}>
        <Probe />
      </AppProviders>,
    )

    expect(received).toBe(client)
  })

  it('falls back to the shared query client when no client is given', () => {
    let received: QueryClient | undefined
    function Probe() {
      received = useQueryClient()
      return null
    }

    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    )

    expect(received).toBe(queryClient)
  })

  it('provides the design-system theme to descendants', () => {
    let received: unknown
    function Probe() {
      received = useTheme()
      return null
    }

    render(
      <AppProviders client={new QueryClient()}>
        <Probe />
      </AppProviders>,
    )

    expect(received).toEqual(theme)
  })
})
