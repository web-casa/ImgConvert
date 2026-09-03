// magick-wasm exposes optional browser-canvas overloads in its main declaration file even when
// it is imported by a Web Worker. These type-only shims keep the worker lib isolated from lib.dom;
// the spike never calls the canvas overloads.
type HTMLCanvasElement = object;
type CanvasRenderingContext2DSettings = object;

declare module "*?url" {
  const url: string;
  export default url;
}
