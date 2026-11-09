export type DevEmail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly sentAt: string;
};

// Local development and browser tests need to read verification codes without
// a real transactional email provider. This module is only wired up when
// DEV_MAILBOX=true; production deployments leave it disabled.
const inbox: Array<DevEmail> = [];

export const recordDevEmail = (message: Omit<DevEmail, "sentAt">) => {
  inbox.unshift({ ...message, sentAt: new Date().toISOString() });
  if (inbox.length > 50) inbox.length = 50;
};

export const listDevEmails = (): ReadonlyArray<DevEmail> => inbox;
