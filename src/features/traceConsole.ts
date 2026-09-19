export type ConsoleEntry = {
  readonly sequence: number;
  readonly level: 'log' | 'error';
  readonly text: string;
};
