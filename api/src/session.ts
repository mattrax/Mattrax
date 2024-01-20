export type SessionData = {
  id: number;
  name: string;
  email: string;
};

export type GetSessionResult = {
  readonly id: string | undefined;
  readonly data: SessionData | undefined;
  update: (data: SessionData) => Promise<void>;
  clear: () => Promise<void>;
};

export type GetSessionResultWithData = {
  readonly id: string | undefined;
  readonly data: SessionData;
  update: (data: SessionData) => Promise<void>;
  clear: () => Promise<void>;
};
