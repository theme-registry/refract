const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
export default noop;
export const ThemeProvider = noop;
export const createGlobalStyle = () => noop;
export const css = () => [];
export const keyframes = () => "";
