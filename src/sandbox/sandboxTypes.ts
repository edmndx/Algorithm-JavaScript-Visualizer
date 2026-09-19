export type SandboxHealth = {
  readonly status: 'ok';
  readonly instanceId: string;
};

export type SandboxWorkerApi = {
  ping(): SandboxHealth;
};
