import { Window } from 'happy-dom';

const domWindow = new Window({ url: 'http://localhost/' });

Object.defineProperties(globalThis, {
  window: { configurable: true, value: domWindow },
  document: { configurable: true, value: domWindow.document },
  navigator: { configurable: true, value: domWindow.navigator },
  Node: { configurable: true, value: domWindow.Node },
  Element: { configurable: true, value: domWindow.Element },
  HTMLElement: { configurable: true, value: domWindow.HTMLElement },
  SVGElement: { configurable: true, value: domWindow.SVGElement },
  SVGSVGElement: { configurable: true, value: domWindow.SVGSVGElement },
  requestAnimationFrame: {
    configurable: true,
    value: domWindow.requestAnimationFrame.bind(domWindow),
  },
  cancelAnimationFrame: {
    configurable: true,
    value: domWindow.cancelAnimationFrame.bind(domWindow),
  },
  getComputedStyle: {
    configurable: true,
    value: domWindow.getComputedStyle.bind(domWindow),
  },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
});

export function createSvg(): SVGSVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

export async function settleD3(duration = 240): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, duration);
  });
}
