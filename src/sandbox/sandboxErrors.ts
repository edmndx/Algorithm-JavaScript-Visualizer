export type SandboxErrorKind =
  | 'worker-creation'
  | 'communication'
  | 'worker-crashed'
  | 'timeout'
  | 'disposed';

export class SandboxError extends Error {
  readonly kind: SandboxErrorKind;

  constructor(kind: SandboxErrorKind, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SandboxError';
    this.kind = kind;
  }
}
