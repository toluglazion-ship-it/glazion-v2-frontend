import { useQuery } from '@tanstack/react-query';
import { usersApi } from '@glazion/api-client';
import { AccountStatus, UserRole, type TileTaskDto, type TileTaskStage, type UserDto } from '@glazion/types';
import { formatDate, type Tone } from '@glazion/ui';

/** What each stage is called on screen, in the order a tile goes through them. */
export const STAGE_LABEL: Record<TileTaskStage, string> = {
  Assigned: 'Not started',
  Started: 'Being made',
  Done: 'Made: check it',
  AwaitingPhoto: 'Waiting for photo',
  InReview: 'Photo in review',
  Approved: 'Approved',
  Cancelled: 'Deleted',
};

export function stageBadge(task: TileTaskDto): { label: string; tone: Tone } {
  switch (task.stage) {
    case 'Started':
      return task.returnNote ? { label: 'Returned', tone: 'warn' } : { label: STAGE_LABEL.Started, tone: 'neutral' };
    case 'Done':
      return { label: STAGE_LABEL.Done, tone: 'warn' };
    case 'AwaitingPhoto':
      return task.retakeReason ? { label: 'Retake photo', tone: 'bad' } : { label: STAGE_LABEL.AwaitingPhoto, tone: 'info' };
    case 'InReview':
      return { label: STAGE_LABEL.InReview, tone: 'warn' };
    case 'Approved':
      return { label: STAGE_LABEL.Approved, tone: 'ok' };
    default:
      return { label: STAGE_LABEL[task.stage], tone: 'neutral' };
  }
}

/** Not checked by an admin yet (not started, being made, or made), so it can be moved to someone else (meeting 2026-11-02). */
export const isOpen = (task: TileTaskDto) => task.stage === 'Assigned' || task.stage === 'Started' || task.stage === 'Done';

/** Can still be deleted: until a photo of it is in review or approved. */
export const isCancellable = (task: TileTaskDto) => isOpen(task) || task.stage === 'AwaitingPhoto';

/** Made and waiting for an admin to check it, then approve it for its photo or return it. */
export const isMade = (task: TileTaskDto) => task.stage === 'Done';

/** A due date (YYYY-MM-DD) as the calendar day it names, whatever the time zone. */
export const dueText = (dueOn: string | null) => (dueOn ? formatDate(`${dueOn}T12:00:00`) : null);

/** The earliest due date the API accepts: today, by its (UTC) calendar. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

export const userLabel = (u: Pick<UserDto, 'username' | 'displayName' | 'participantCode'>) =>
  [u.participantCode, u.displayName ? `${u.displayName} (@${u.username ?? '?'})` : `@${u.username ?? '?'}`].filter(Boolean).join(' · ');

/** Active participant accounts: the people a task can go to. */
export function useAssignees() {
  const users = useQuery({ queryKey: ['users', 'options'], queryFn: () => usersApi.list({ pageSize: 100 }) });
  const assignees = (users.data?.items ?? [])
    .filter((u) => u.role === UserRole.Standard && u.accountStatus === AccountStatus.Active)
    .sort((a, b) => (a.participantCode ?? '~').localeCompare(b.participantCode ?? '~', undefined, { numeric: true }) || (a.username ?? '').localeCompare(b.username ?? ''));
  return { ...users, assignees };
}
