export interface OwnershipClaim {
  readonly id: string
  readonly dispose: () => void | Promise<void>
}

export interface TitleSlot {
  owner(): string | undefined
  occupy(id: string): Promise<() => void | Promise<void>>
}

/** Exclusive title-provider ownership. Enable claims the slot; disable releases only while this id still holds it. */
export async function claimTitleSlot(slot: TitleSlot, id: string): Promise<OwnershipClaim> {
  const dispose = await slot.occupy(id)
  return { id, dispose }
}

export async function releaseTitleSlot(
  slot: TitleSlot,
  claim: OwnershipClaim | undefined,
): Promise<'released' | 'left-other-owner' | 'idle'> {
  if (!claim) return 'idle'
  if (slot.owner() !== claim.id) return 'left-other-owner'
  await claim.dispose()
  if (slot.owner() && slot.owner() !== claim.id) return 'left-other-owner'
  return 'released'
}

export function occupiedProviderId(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error)
  return /session-title provider "([^"]+)" is already registered/.exec(message)?.[1]
}
