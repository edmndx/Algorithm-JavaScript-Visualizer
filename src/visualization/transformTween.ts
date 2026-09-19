import { interpolateString } from 'd3';

export function createStringAttributeTween<Datum>(
  attribute: string,
  target: (datum: Datum) => string,
): (this: SVGElement, datum: Datum) => (progress: number) => string {
  return function attributeTween(datum) {
    const targetValue = target(datum);
    return interpolateString(
      this.getAttribute(attribute) ?? targetValue,
      targetValue,
    );
  };
}

export function createTransformTween<Datum>(
  target: (datum: Datum) => string,
): (this: SVGElement, datum: Datum) => (progress: number) => string {
  return createStringAttributeTween('transform', target);
}
