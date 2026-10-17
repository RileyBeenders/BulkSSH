// The preload bridge. Undefined when the renderer is opened in a plain browser
// (dev preview), in which case the UI renders but cannot connect.
export const bridge = window.bulkssh
