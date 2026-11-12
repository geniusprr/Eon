import type { IpcChannel } from '../../../shared/contracts'
import type { PcAction } from '../../../shared/eon-controls'
import { newAction } from './actionForm'

type Invoke = <T = unknown>(channel: IpcChannel, payload?: unknown) => Promise<T>

/** Uses the existing PcActions registry; never requires a user-created cancel shortcut. */
export async function cancelScheduledPower(actions: readonly PcAction[], invoke: Invoke): Promise<void> {
  let cancel = actions.find(action => action.kind === 'cancel')
  let temporaryId: string | null = null
  if (!cancel) {
    // The registry is the sole execution authority. Provision a local-only entry,
    // execute it, then remove it even if execution fails.
    cancel = await invoke<PcAction>('eon2:actions:save', {
      ...newAction('cancel'), name: 'Güç planını iptal et', remoteEnabled: false,
    })
    temporaryId = cancel.id
  }
  try {
    await invoke('eon2:actions:execute', { id: cancel.id })
  } finally {
    if (temporaryId) await invoke('eon2:actions:delete', { id: temporaryId })
  }
}
