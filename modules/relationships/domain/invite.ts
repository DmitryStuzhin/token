import { assertTransition, type TransitionMap } from '../../shared/domain/state-machine.js';

export type InviteStatus = 'active' | 'used_up' | 'expired' | 'revoked';

const transitions: TransitionMap<InviteStatus> = {
  active: ['used_up', 'expired', 'revoked'],
  used_up: [],
  expired: [],
  revoked: [],
};

export function transitionInvite(from: InviteStatus, to: InviteStatus): InviteStatus {
  assertTransition('Invite', transitions, from, to);
  return to;
}

export function effectiveInviteStatus(
  status: InviteStatus,
  expiresAt: string | null,
  at: Date,
): InviteStatus {
  if (status === 'active' && expiresAt && new Date(expiresAt).getTime() < at.getTime()) {
    return transitionInvite(status, 'expired');
  }
  return status;
}
