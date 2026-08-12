import { getAlgorithmById } from './loadData';

export type CodeEditorValue = {
  code: string;
  revision: number;
};

export type CodeEditorChange = {
  code: string;
};

export function createCodeEditorValue(
  code: string,
  revision = 0,
): CodeEditorValue {
  return {
    code,
    revision,
  };
}

export function updateCodeEditorValue(
  current: CodeEditorValue,
  code: string,
): CodeEditorValue {
  if (code === current.code) {
    return current;
  }

  return {
    code,
    revision: current.revision + 1,
  };
}

export function loadStarterCode(algorithmId: string): string | undefined {
  return getAlgorithmById(algorithmId)?.code;
}
