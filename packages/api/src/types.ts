export type HonoEnv = {
  Bindings: {
    session: GetSessionResult;
  };
};

export type SessionData = {
  // Data for OAuth flow
  oauthData?: {
    // Mattrax tenant to send the user back to
    tenant: number;
    // EntraID tenant. The ownership of this must be verified before putting it here.
    entraIdTenant?: string;
    // Used for CSRF protection
    state: string;
  };
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
